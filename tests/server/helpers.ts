import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type Deps } from "../../src/server/app.ts";
import { appConfig } from "../../src/server/config.ts";
import { toBase64, toBase64Url, sha256 } from "../../src/server/crypto.ts";
import { diskFiles } from "../../src/server/files/disk.ts";
import { KeyVault } from "../../src/server/keys.ts";
import { memoryLimiter } from "../../src/server/limits.ts";
import type { MailMessage } from "../../src/server/mail/mail.ts";
import { migrate, openSqlite } from "../../src/server/storage/sqlite.ts";
import { Store } from "../../src/server/storage/store.ts";
import type { HostedKeys } from "../../src/server/transcription.ts";
import type { JobResult, Provider, Transcriber, Transcript } from "../../src/server/transcriber/transcriber.ts";

export const ORIGIN = "http://localhost:8787";
export const ADMIN = "admin@example.org";

export function transcript(provider: Provider = "deepgram", duration = 120): Transcript {
  return {
    format: "minuteca-transcript",
    version: 1,
    provider,
    model: "test",
    language: "es",
    duration,
    blocks: [
      { speaker: 0, start: 0, end: 4, text: "Buenos días a todos." },
      { speaker: 1, start: 4.5, end: 9, text: "Empecemos con la agenda." },
    ],
  };
}

/** A finished job whose raw answer is already in our format (the fake's fromRaw is the identity). */
export const done = (t: Transcript = transcript(), providerJobId?: string): JobResult => ({
  status: "done",
  raw: new TextEncoder().encode(JSON.stringify(t)),
  ...(providerJobId ? { providerJobId } : {}),
});

/** A transcriber whose answers the test controls. */
export function fakeTranscriber(provider: Provider, opts: { result?: () => JobResult; maxBytes?: number; poll?: () => JobResult; callback?: boolean } = {}) {
  const calls: { url?: string; apiKey: string; language?: string; callbackUrl?: string; bytes?: number }[] = [];
  const t: Transcriber & { calls: typeof calls; checked: string[]; forgotten: string[] } = {
    provider,
    maxBytes: opts.maxBytes ?? 1024 ** 3,
    calls,
    checked: [],
    forgotten: [],
    async start(audio, o) {
      calls.push({ url: audio.url, apiKey: o.apiKey, language: o.language, callbackUrl: o.callbackUrl, bytes: audio.url ? undefined : (await audio.bytes()).length });
      return opts.result ? opts.result() : done(transcript(provider));
    },
    fromRaw: (raw) => raw as Transcript,
    async checkKey(k) {
      t.checked.push(k);
      return k.startsWith("good");
    },
  };
  if (opts.poll) t.poll = async () => opts.poll!();
  if (opts.callback) t.callback = async (body) => ({ status: "done", raw: body });
  t.forget = async (id) => {
    t.forgotten.push(id);
  };
  return t;
}

export function setup(over: { env?: Record<string, string>; hosted?: HostedKeys | null; transcribers?: Partial<Record<Provider, Transcriber>>; now?: () => number } = {}) {
  const db = openSqlite(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "minuteca-test-"));
  const mails: MailMessage[] = [];
  let clock = Date.parse("2026-11-06T12:00:00Z");
  const now = over.now ?? (() => clock);
  const keyB64 = toBase64(new Uint8Array(32).fill(7));
  const env = { MINUTECA_ADMIN_EMAILS: ADMIN, ...over.env };
  const tr = {
    deepgram: fakeTranscriber("deepgram"),
    assemblyai: fakeTranscriber("assemblyai"),
    openai: fakeTranscriber("openai"),
    ...over.transcribers,
  } as Record<Provider, ReturnType<typeof fakeTranscriber>>;
  const deps: Deps = {
    store: new Store(db),
    files: diskFiles(dir),
    mail: { send: async (m) => void mails.push(m) },
    vault: KeyVault.fromEnv(keyB64),
    hosted: over.hosted ?? null,
    transcribers: tr,
    limits: { login: memoryLimiter(100, 60), token: memoryLimiter(100, 60) },
    config: appConfig(env, ORIGIN),
    now,
    clientIp: () => "127.0.0.1",
    assets: async () => new Response("<!doctype html><title>minuteca</title>", { headers: { "Content-Type": "text/html" } }),
  };
  const ready = migrate(db);
  const app = createApp(deps);
  const fetchApp = async (path: string, init: RequestInit & { cookie?: string; bearer?: string } = {}) => {
    await ready;
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("Cookie", init.cookie);
    if (init.bearer) headers.set("Authorization", `Bearer ${init.bearer}`);
    if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const method = init.method ?? "GET";
    if (!init.bearer && !["GET", "HEAD"].includes(method) && !headers.has("Origin")) headers.set("Origin", deps.config.origin);
    return app.fetch(new Request(`${deps.config.origin}${path}`, { ...init, headers, ...(init.body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit));
  };

  /** Signs in through the email link and returns the session cookie. */
  const signIn = async (email = ADMIN) => {
    await fetchApp("/api/auth/link", { method: "POST", body: JSON.stringify({ email }) });
    const token = /t=([0-9a-f]{64})/.exec(mails.at(-1)!.text)![1]!;
    const r = await fetchApp("/api/auth/session", { method: "POST", body: JSON.stringify({ token }) });
    if (r.status !== 200) throw new Error(`sign in failed ${r.status}`);
    return r.headers.get("set-cookie")!.split(";")[0]!;
  };

  /** Signs in like the iOS app and returns the bearer token. */
  const appSignIn = async (email = ADMIN) => {
    const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = toBase64Url(await sha256(verifier));
    await fetchApp("/api/auth/link", { method: "POST", body: JSON.stringify({ email, client: "app", challenge }) });
    const token = /t=([0-9a-f]{64})/.exec(mails.at(-1)!.text)![1]!;
    const r = await fetchApp("/api/auth/app-token", { method: "POST", body: JSON.stringify({ token, verifier }), headers: { Origin: "null" } });
    return ((await r.json()) as { token: string }).token;
  };

  const meetingWithAudio = async (cookie: string, id = crypto.randomUUID(), bytes = 4000) => {
    await fetchApp("/api/meetings", { method: "POST", cookie, body: JSON.stringify({ id, title: "Junta", date: "2026-11-05T15:00:00Z", duration: 120 }) });
    const r = await fetchApp(`/api/meetings/${id}/audio`, {
      method: "PUT",
      cookie,
      body: new Uint8Array(bytes).fill(1),
      headers: { "Content-Type": "audio/webm", "Content-Length": String(bytes) },
    });
    if (r.status !== 200) throw new Error(`upload failed ${r.status} ${await r.text()}`);
    return id;
  };

  return {
    db,
    deps,
    mails,
    tr,
    fetch: fetchApp,
    signIn,
    appSignIn,
    meetingWithAudio,
    advance: (ms: number) => {
      clock += ms;
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
