// HTTP API and static files of minuteca. Runs unchanged on Node (node.ts) and Workers (worker.ts).
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Config } from "./config.ts";
import { challengeMatches, randomToken, sha256Hex, TOKEN_RE } from "./crypto.ts";
import { audioKey, parseRange, rawKey, type FileRange, type Files, type StoredFile } from "./files/files.ts";
import { DOWNLOAD_RE, type Downloads } from "./files/downloads.ts";
import { pickLanguage, t } from "./i18n.ts";
import { isKeyVendor, plausibleKey, type KeyVault } from "./keys.ts";
import { isLlmProvider, LLM_PROVIDERS, LlmError, MODEL_RE, type LlmAdapter, type LlmProviderId } from "./llm/llm.ts";
import { generateMinutes, MinutesError, modelFor, suggestSpeakers, type MinutesDeps } from "./minutes.ts";
import type { Limiter } from "./limits.ts";
import type { Mail } from "./mail/mail.ts";
import { isConsentId, monthOf, type MeetingRow, type MinutesRow, type Role, type Store, type User } from "./storage/store.ts";
import {
  completeFromCallback,
  finishTranscript,
  hostedRemainingSeconds,
  jobByToken,
  refreshJob,
  startTranscription,
  TranscriptionError,
  type HostedKeys,
  type TranscriptionDeps,
} from "./transcription.ts";
import { isProvider, isTranscript, PROVIDERS, ProviderError, withSpeakers, type Provider, type Transcriber } from "./transcriber/transcriber.ts";

export interface Deps {
  store: Store;
  files: Files;
  mail: Mail;
  vault: KeyVault | null;
  hosted: HostedKeys | null;
  transcribers: Record<Provider, Transcriber>;
  /** Language models for names and minutes; "local" only when the administrator set it up. */
  llm: Partial<Record<LlmProviderId, LlmAdapter>>;
  limits: { login: Limiter; token: Limiter; llm: Limiter };
  config: Config;
  now: () => number;
  /** Client IP for rate limits, as reported by the platform (never a header the client controls). */
  clientIp: (req: Request) => string;
  /** Static files of the web app (dist/). */
  assets?: (req: Request) => Promise<Response>;
  /** Desktop installers and update feeds (ADR 0005); absent where none are published. */
  downloads?: Downloads;
}

type Env = { Variables: { user: User; lang: string; auth: "cookie" | "bearer" } };
type C = Context<Env>;

const LOGIN_MINUTES = 30;
const WEB_SESSION_DAYS = 30;
const APP_SESSION_DAYS = 90;
const MINUTE = 60_000;
const DAY = 86_400_000;
const EMAIL_RE = /^[^\s@<>()",;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const LANGUAGE_RE = /^(multi|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/;
const AUDIO_TYPE_RE = /^(audio|video)\/[\w.+-]{1,60}$/;
const SOURCES = new Set(["web", "import", "ios"]);
const MAX_INSTRUCTIONS = 2000;
const MAX_MINUTES = 200_000;

export function minutesJson(m: MinutesRow | null) {
  return m
    ? { body: m.body, provider: m.provider, model: m.model, edited: Boolean(m.edited), createdAt: new Date(m.created_at).toISOString(), updatedAt: new Date(m.updated_at).toISOString() }
    : null;
}
/** D1 stores values of up to 2 MB; a 6 hour meeting is about 1 MB in our format. */
const MAX_TRANSCRIPT_BYTES = 1_900_000;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function meetingJson(m: MeetingRow) {
  let speakerNames: Record<string, string> = {};
  try {
    speakerNames = JSON.parse(m.speaker_names) as Record<string, string>;
  } catch {
    speakerNames = {};
  }
  return {
    id: m.id,
    title: m.title,
    date: m.date,
    source: m.source,
    status: m.status,
    error: m.error,
    duration: m.duration,
    language: m.language,
    speakerNames,
    hasAudio: Boolean(m.audio_key),
    audioType: m.audio_type,
    audioBytes: m.audio_bytes,
    provider: m.provider,
    keySource: m.key_source,
    createdAt: new Date(m.created_at).toISOString(),
    expiresAt: new Date(m.expires_at).toISOString(),
  };
}

export function createApp(deps: Deps) {
  const { store, files, config } = deps;
  const app = new Hono<Env>();
  const secure = config.origin.startsWith("https://");
  const cookieName = secure ? "__Host-minuteca" : "minuteca_session";
  const tdeps: TranscriptionDeps = {
    store,
    files,
    vault: deps.vault,
    hosted: deps.hosted,
    transcribers: deps.transcribers,
    now: deps.now,
    origin: config.origin,
    providerAudio: config.providerAudio,
    convert: config.convert,
  };
  const mdeps: MinutesDeps = { store, vault: deps.vault, llm: deps.llm, now: deps.now, timeZone: config.timeZone };

  const err = (c: C, status: number, code: string) => c.json({ error: code }, status as 400);
  const sameOrigin = (c: C) => {
    const origin = c.req.header("Origin");
    if (origin) return origin === config.origin;
    return c.req.header("Sec-Fetch-Site") === "same-origin";
  };
  const body = async <T,>(c: C): Promise<Partial<T>> => {
    try {
      const b = (await c.req.json()) as unknown;
      return b && typeof b === "object" ? (b as Partial<T>) : {};
    } catch {
      return {};
    }
  };

  app.use("*", async (c, next) => {
    c.set("lang", pickLanguage(c.req.header("Accept-Language")));
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "no-referrer");
    c.res.headers.set("Permissions-Policy", "microphone=(self), camera=(), geolocation=()");
    if (!c.res.headers.has("Content-Security-Policy")) c.res.headers.set("Content-Security-Policy", CSP);
    if (secure) c.res.headers.set("Strict-Transport-Security", "max-age=31536000");
    // API answers are never cached, unless a route says otherwise (desktop installers, audio).
    if (c.req.path.startsWith("/api/") && !c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
  });

  app.get("/health", (c) => c.json({ ok: true, core: config.coreSha }));

  /** Desktop installers and update feeds (ADR 0005): public, like any download page. */
  app.get("/api/desktop/:file", (c) => {
    const name = c.req.param("file") ?? "";
    if (!deps.downloads || !DOWNLOAD_RE.test(name)) return err(c, 404, "not_found");
    const feed = name.endsWith(".yml");
    return sendFile(c, (range) => deps.downloads!.get(name, range), {
      // Feeds change with each release; installers never change under the same name.
      "Cache-Control": feed ? "no-cache" : "public, max-age=86400",
      ...(feed ? {} : { "Content-Disposition": `attachment; filename="${name}"` }),
    });
  });

  /* ---------- sign in (docs/adr/0003-access.md) ---------- */

  const canSignIn = async (email: string) => {
    if (config.adminEmails.includes(email)) return true;
    const u = await store.userByEmail(email);
    return Boolean(u && u.role !== "removed");
  };

  app.post("/api/auth/link", async (c) => {
    const b = await body<{ email: string; client: string; challenge: string; device: string }>(c);
    const email = String(b.email ?? "").trim().toLowerCase();
    const client = b.client === "app" ? "app" : "web";
    // Apps: the iPhone recorder, or the desktop app (ADR 0005). Same flow, other words in the mail and page.
    const desktop = client === "app" && b.device === "desktop";
    if (!EMAIL_RE.test(email)) return err(c, 400, "invalid_email");
    if (client === "web" && !sameOrigin(c)) return err(c, 403, "bad_origin");
    const challenge = client === "app" ? String(b.challenge ?? "") : null;
    if (client === "app" && !/^[A-Za-z0-9_-]{43}$/.test(challenge!)) return err(c, 400, "invalid_challenge");
    const ip = deps.clientIp(c.req.raw);
    if (!(await deps.limits.login.allow(`ip:${ip}`)) || !(await deps.limits.login.allow(`email:${email}`))) return err(c, 429, "too_many");
    // Same answer whether the email is on the access list or not.
    if (await canSignIn(email)) {
      const token = randomToken();
      await store.addLoginToken(await sha256Hex(token), email, client, challenge, deps.now() + LOGIN_MINUTES * MINUTE);
      const link = `${config.origin}/acceso?t=${token}${desktop ? "&app=desktop" : client === "app" ? "&app=1" : ""}`;
      const lang = c.get("lang");
      try {
        await deps.mail.send({
          to: email,
          subject: t(lang, "mail.signIn.subject"),
          text: t(lang, desktop ? "mail.signIn.bodyDesktop" : client === "app" ? "mail.signIn.bodyApp" : "mail.signIn.body", { link, minutes: LOGIN_MINUTES }),
        });
      } catch (e) {
        console.error("mail", (e as Error).message);
        return err(c, 502, "mail_failed");
      }
    }
    return c.json({ ok: true });
  });

  /** Creates or upgrades the user row of an email that proved it controls its inbox. */
  const userForEmail = async (email: string) => {
    const isAdmin = config.adminEmails.includes(email);
    const existing = await store.userByEmail(email);
    if (existing && existing.role !== "removed") return isAdmin && existing.role !== "admin" ? store.saveUser(email, "admin", null, deps.now()) : existing;
    if (isAdmin) return store.saveUser(email, "admin", null, deps.now());
    return null;
  };

  app.post("/api/auth/session", async (c) => {
    if (!sameOrigin(c)) return err(c, 403, "bad_origin");
    if (!(await deps.limits.token.allow(`ip:${deps.clientIp(c.req.raw)}`))) return err(c, 429, "too_many");
    const token = String((await body<{ token: string }>(c)).token ?? "");
    const row = TOKEN_RE.test(token) ? await store.takeLoginToken(await sha256Hex(token), deps.now()) : null;
    if (!row || row.client !== "web") return err(c, 400, "link_expired");
    const user = await userForEmail(row.email);
    if (!user) return err(c, 403, "not_allowed");
    const session = randomToken();
    await store.addSession(await sha256Hex(session), user.id, "web", deps.now(), deps.now() + WEB_SESSION_DAYS * DAY);
    setCookie(c, cookieName, session, { path: "/", httpOnly: true, secure, sameSite: "Lax", maxAge: WEB_SESSION_DAYS * 86_400 });
    return c.json({ ok: true });
  });

  app.post("/api/auth/app-token", async (c) => {
    if (!(await deps.limits.token.allow(`ip:${deps.clientIp(c.req.raw)}`))) return err(c, 429, "too_many");
    const b = await body<{ token: string; verifier: string }>(c);
    const token = String(b.token ?? "");
    const row = TOKEN_RE.test(token) ? await store.takeLoginToken(await sha256Hex(token), deps.now()) : null;
    if (!row || row.client !== "app" || !row.challenge || !(await challengeMatches(String(b.verifier ?? ""), row.challenge))) {
      return err(c, 400, "link_expired");
    }
    const user = await userForEmail(row.email);
    if (!user) return err(c, 403, "not_allowed");
    const session = randomToken();
    const expiresAt = deps.now() + APP_SESSION_DAYS * DAY;
    await store.addSession(await sha256Hex(session), user.id, "app", deps.now(), expiresAt);
    return c.json({ token: session, email: user.email, expiresAt: new Date(expiresAt).toISOString() });
  });

  const sessionToken = (c: C): { token: string; via: "cookie" | "bearer" } | null => {
    const h = c.req.header("Authorization");
    if (h?.startsWith("Bearer ")) return { token: h.slice(7).trim(), via: "bearer" };
    const cookie = getCookie(c, cookieName);
    return cookie ? { token: cookie, via: "cookie" } : null;
  };

  app.post("/api/auth/logout", async (c) => {
    const s = sessionToken(c);
    if (s?.via === "cookie" && !sameOrigin(c)) return err(c, 403, "bad_origin");
    if (s && TOKEN_RE.test(s.token)) await store.deleteSession(await sha256Hex(s.token));
    deleteCookie(c, cookieName, { path: "/", secure });
    return c.json({ ok: true });
  });

  /* ---------- everything below needs a session ---------- */

  const authed = new Hono<Env>();
  authed.use("*", async (c, next) => {
    const s = sessionToken(c);
    const user = s && TOKEN_RE.test(s.token) ? await store.sessionUser(await sha256Hex(s.token), deps.now()) : null;
    if (!user) return err(c, 401, "signed_out");
    // Cookies are sent by the browser on its own; bearer tokens are not, so only cookies need the origin check.
    if (s!.via === "cookie" && !["GET", "HEAD"].includes(c.req.method) && !sameOrigin(c)) return err(c, 403, "bad_origin");
    c.set("user", user);
    c.set("auth", s!.via);
    await next();
  });

  authed.get("/me", async (c) => {
    const user = c.get("user");
    const month = monthOf(deps.now());
    const keys = await store.providerKeys(user.id);
    const hostedOn = Boolean(deps.hosted?.allowed(user));
    return c.json({
      email: user.email,
      role: user.role,
      provider: user.provider,
      consents: user.consents,
      keysEnabled: Boolean(deps.vault),
      providers: PROVIDERS.map((id) => {
        const k = keys.find((x) => x.provider === id);
        return { id, ownKey: k ? { last4: k.last4, addedAt: new Date(k.created_at).toISOString() } : null, hosted: hostedOn && Boolean(deps.hosted?.key(id)) };
      }),
      usage: {
        month,
        ownSeconds: await store.usedSeconds(month, "own", user.id),
        hostedSeconds: await store.usedSeconds(month, "hosted", user.id),
      },
      hosted: hostedOn ? { remainingSeconds: await hostedRemainingSeconds(tdeps), capSeconds: deps.hosted!.monthlyCapSeconds } : null,
      llm: {
        provider: user.llmProvider,
        instructions: user.minutesInstructions,
        providers: LLM_PROVIDERS.filter((id) => deps.llm[id]).map((id) => {
          const adapter = deps.llm[id]!;
          const k = keys.find((x) => x.provider === id);
          return {
            id,
            needsKey: adapter.needsKey,
            ownKey: k ? { last4: k.last4, addedAt: new Date(k.created_at).toISOString() } : null,
            model: modelFor(user, adapter),
            defaultModel: adapter.defaultModel,
          };
        }),
        usage: await store.llmUsageOf(user.id, month),
      },
      retentionDays: config.retentionDays,
      maxAudioBytes: config.maxAudioBytes,
    });
  });

  authed.put("/me/provider", async (c) => {
    const p = (await body<{ provider: string }>(c)).provider;
    if (!isProvider(p)) return err(c, 400, "invalid_provider");
    await store.setProvider(c.get("user").id, p);
    return c.json({ ok: true });
  });

  /** Permission to send audio to a provider (AGENTS: nothing leaves towards an AI without it). */
  authed.put("/me/consents", async (c) => {
    const b = await body<{ provider: string; granted: boolean }>(c);
    if (!isConsentId(b.provider)) return err(c, 400, "invalid_provider");
    const user = c.get("user");
    const id = b.provider;
    const next = b.granted === true ? [...user.consents, id] : user.consents.filter((p) => p !== id);
    await store.setConsents(user.id, next);
    return c.json({ consents: [...new Set(next)] });
  });

  /** Language model for names and minutes, a model per provider, and the person's instructions. */
  authed.put("/me/llm", async (c) => {
    const user = c.get("user");
    const b = await body<{ provider: string | null; models: Record<string, unknown>; instructions: string }>(c);
    let provider = user.llmProvider;
    if (b.provider === null) provider = null;
    else if (b.provider !== undefined) {
      if (!isLlmProvider(b.provider) || !deps.llm[b.provider]) return err(c, 400, "invalid_provider");
      provider = b.provider;
    }
    const models = { ...user.llmModels };
    if (b.models && typeof b.models === "object") {
      for (const [k, v] of Object.entries(b.models)) {
        if (!isLlmProvider(k)) return err(c, 400, "invalid_provider");
        if (v === "" || v === null) delete models[k];
        else if (typeof v === "string" && MODEL_RE.test(v.trim())) models[k] = v.trim();
        else return err(c, 400, "invalid_model");
      }
    }
    let instructions = user.minutesInstructions;
    if (typeof b.instructions === "string") instructions = b.instructions.trim().slice(0, MAX_INSTRUCTIONS);
    await store.setLlmSettings(user.id, { provider, models, instructions });
    return c.json({ ok: true });
  });

  /* ---------- own provider keys (docs/design/own-provider-keys.md) ---------- */

  authed.put("/keys/:provider", async (c) => {
    if (!deps.vault) return err(c, 503, "keys_disabled");
    const provider = c.req.param("provider") ?? "";
    const key = (await body<{ key: string }>(c)).key;
    if (!isKeyVendor(provider) || !plausibleKey(provider, key)) return err(c, 400, "invalid_key");
    if (!(await deps.limits.token.allow(`key:${c.get("user").id}`))) return err(c, 429, "too_many");
    // One key per vendor: OpenAI's serves transcription and minutes alike.
    const checker = isProvider(provider) ? deps.transcribers[provider] : isLlmProvider(provider) ? deps.llm[provider] : undefined;
    if (!checker) return err(c, 400, "invalid_provider");
    let ok: boolean;
    try {
      ok = await checker.checkKey(key);
    } catch (e) {
      if (e instanceof LlmError && e.code === "region") return err(c, 502, "llm_region");
      return err(c, 502, "provider_unavailable");
    }
    if (!ok) return err(c, 400, "invalid_key");
    const user = c.get("user");
    await store.saveProviderKey(user.id, provider, await deps.vault.seal(user.id, provider, key), deps.now());
    return c.json({ provider, last4: key.slice(-4) });
  });

  authed.delete("/keys/:provider", async (c) => {
    const provider = c.req.param("provider") ?? "";
    if (!isKeyVendor(provider)) return err(c, 400, "invalid_provider");
    await store.deleteProviderKey(c.get("user").id, provider);
    return c.json({ ok: true });
  });

  /* ---------- meetings ---------- */

  authed.get("/meetings", async (c) => c.json({ meetings: (await store.listMeetings(c.get("user").id)).map(meetingJson) }));

  authed.post("/meetings", async (c) => {
    const user = c.get("user");
    const b = await body<{ id: string; title: string; date: string; source: string; duration: number }>(c);
    const id = String(b.id ?? "");
    if (!ID_RE.test(id)) return err(c, 400, "invalid_id");
    const existing = await store.meetingById(id);
    if (existing) return existing.user_id === user.id ? c.json(meetingJson(existing)) : err(c, 409, "id_taken");
    const parsed = new Date(String(b.date ?? ""));
    const date = Number.isNaN(parsed.getTime()) ? new Date(deps.now()) : parsed;
    const duration = Number(b.duration);
    await store.createMeeting({
      id,
      userId: user.id,
      title: String(b.title ?? "").trim().slice(0, 200) || date.toISOString().slice(0, 16).replace("T", " "),
      date: date.toISOString(),
      source: SOURCES.has(String(b.source)) ? String(b.source) : "web",
      duration: Number.isFinite(duration) && duration > 0 ? Math.min(duration, 86_400) : 0,
      now: deps.now(),
      retentionDays: config.retentionDays,
    });
    return c.json(meetingJson((await store.meeting(user.id, id))!), 201);
  });

  const ownMeeting = async (c: C) => {
    const id = c.req.param("id") ?? "";
    return ID_RE.test(id) ? store.meeting(c.get("user").id, id) : null;
  };

  authed.get("/meetings/:id", async (c) => {
    let m = await ownMeeting(c);
    if (!m) return err(c, 404, "not_found");
    if (m.status === "transcribing") {
      await refreshJob(tdeps, m);
      m = (await ownMeeting(c))!;
    }
    // The transcript goes out as stored, without parsing it again (CPU-limited hosts).
    const transcript = m.status === "done" ? await store.transcriptText(m.id) : null;
    const head = JSON.stringify({ ...meetingJson(m), minutes: minutesJson(await store.minutes(m.id)) });
    return new Response(`${head.slice(0, -1)},"transcript":${transcript ?? "null"}}`, { headers: { "Content-Type": "application/json; charset=utf-8" } });
  });

  authed.patch("/meetings/:id", async (c) => {
    const m = await ownMeeting(c);
    if (!m) return err(c, 404, "not_found");
    const b = await body<{ title: string; speakerNames: Record<string, unknown>; speakers: number[] }>(c);
    const changes: { title?: string; speakerNames?: Record<string, string> } = {};
    if (typeof b.title === "string") changes.title = b.title.trim().slice(0, 200) || m.title;
    if (b.speakerNames && typeof b.speakerNames === "object") {
      const names: Record<string, string> = {};
      for (const [k, v] of Object.entries(b.speakerNames).slice(0, 100)) {
        if (/^\d{1,2}$/.test(k) && typeof v === "string") names[k] = v.trim().slice(0, 100);
      }
      changes.speakerNames = names;
    }
    await store.updateMeeting(m.user_id, m.id, changes);
    if (b.speakers !== undefined) {
      const current = await store.transcript(m.id);
      const next = current && isTranscript(current) ? withSpeakers(current, b.speakers) : null;
      if (!next) return err(c, 400, "invalid_speakers");
      await store.saveTranscript(m.id, next);
    }
    return c.json(meetingJson((await ownMeeting(c))!));
  });

  authed.delete("/meetings/:id", async (c) => {
    const m = await ownMeeting(c);
    if (!m) return err(c, 404, "not_found");
    if (m.audio_key) await files.delete(m.audio_key);
    await files.delete(rawKey(m.user_id, m.id));
    await store.deleteMeeting(m.user_id, m.id);
    return c.json({ ok: true });
  });

  authed.put("/meetings/:id/audio", async (c) => {
    const m = await ownMeeting(c);
    if (!m) return err(c, 404, "not_found");
    if (m.status === "transcribing" || m.status === "done") return err(c, 409, "already_transcribed");
    const type = (c.req.header("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!AUDIO_TYPE_RE.test(type)) return err(c, 415, "not_audio");
    const size = Number(c.req.header("Content-Length"));
    if (!Number.isInteger(size) || size <= 0) return err(c, 411, "length_required");
    if (size > config.maxAudioBytes) return err(c, 413, "too_large");
    const stream = c.req.raw.body;
    if (!stream) return err(c, 400, "empty");
    const key = audioKey(m.user_id, m.id);
    try {
      await files.put(key, stream, type, size);
    } catch (e) {
      console.error("upload", m.id, (e as Error).message);
      return err(c, 400, "upload_incomplete");
    }
    const duration = Number(c.req.header("X-Audio-Duration"));
    await store.setAudio(m.user_id, m.id, key, type, size, Number.isFinite(duration) && duration > 0 ? Math.min(duration, 86_400) : null);
    // The iPhone recorder only uploads: its recordings are transcribed right away when the person
    // already allowed their provider (the permission dialog says so). Without it, they wait.
    if (m.source === "ios" && (m.status === "created" || m.status === "uploaded")) {
      const job = autoTranscribe(tdeps, m.user_id, m.id);
      try {
        c.executionCtx.waitUntil(job);
      } catch {
        // Node has no execution context: the promise simply runs on.
      }
    }
    return c.json(meetingJson((await ownMeeting(c))!));
  });

  const sendAudio = (c: C, key: string) => sendFile(c, (range) => files.get(key, range), { "Cache-Control": "private, no-store" });

  authed.get("/meetings/:id/audio", async (c) => {
    const m = await ownMeeting(c);
    if (!m?.audio_key) return err(c, 404, "not_found");
    return sendAudio(c, m.audio_key);
  });

  authed.delete("/meetings/:id/audio", async (c) => {
    const m = await ownMeeting(c);
    if (!m?.audio_key) return err(c, 404, "not_found");
    if (m.status === "transcribing") return err(c, 409, "busy");
    await files.delete(m.audio_key);
    await store.clearAudio(m.user_id, m.id);
    return c.json(meetingJson((await ownMeeting(c))!));
  });

  authed.post("/meetings/:id/transcribe", async (c) => {
    const user = c.get("user");
    const b = await body<{ provider: string; language: string }>(c);
    const provider = b.provider === undefined ? user.provider : b.provider;
    if (!isProvider(provider)) return err(c, 400, "invalid_provider");
    let language = typeof b.language === "string" && LANGUAGE_RE.test(b.language) ? b.language : undefined;
    if (language === "multi" && provider !== "deepgram") language = undefined;
    try {
      const m = await startTranscription(tdeps, user, c.req.param("id") ?? "", { provider, language });
      return c.json(meetingJson(m));
    } catch (e) {
      if (e instanceof TranscriptionError) return err(c, e.status, e.code);
      throw e;
    }
  });

  /* ---------- provider answers converted in the browser (convert: "client") ---------- */

  authed.get("/meetings/:id/raw", async (c) => {
    const m = await ownMeeting(c);
    if (!m || m.status !== "converting") return err(c, 404, "not_found");
    const f = await files.get(rawKey(m.user_id, m.id));
    if (!f) return err(c, 404, "not_found");
    return new Response(f.body, { headers: { "Content-Type": "application/json", "Content-Length": String(f.size), "X-Provider": m.provider ?? "" } });
  });

  authed.put("/meetings/:id/transcript", async (c) => {
    const m = await ownMeeting(c);
    if (!m) return err(c, 404, "not_found");
    if (m.status !== "converting") return err(c, 409, "not_converting");
    if (Number(c.req.header("Content-Length") ?? 0) > MAX_TRANSCRIPT_BYTES) return err(c, 413, "too_large");
    const t = (await body<{ transcript: unknown }>(c)).transcript;
    if (!isTranscript(t) || t.provider !== m.provider || t.blocks.length > 50_000) return err(c, 400, "invalid_transcript");
    await finishTranscript(tdeps, m, t);
    return c.json(meetingJson((await ownMeeting(c))!));
  });

  /**
   * A transcript made on the person's computer by the desktop app (ADR 0005). Nothing is paid or sent
   * to a provider, so no permission or key applies; the audio must be here and no cloud job running.
   */
  authed.put("/meetings/:id/transcript/local", async (c) => {
    const m = await ownMeeting(c);
    if (!m) return err(c, 404, "not_found");
    if (!m.audio_key || !["uploaded", "error", "done"].includes(m.status)) return err(c, 409, "not_ready");
    if (Number(c.req.header("Content-Length") ?? 0) > MAX_TRANSCRIPT_BYTES) return err(c, 413, "too_large");
    const t = (await body<{ transcript: unknown }>(c)).transcript;
    if (!isTranscript(t) || (t.provider as string) !== "local" || t.blocks.length > 50_000 || (!t.blocks.length && !t.duration)) {
      return err(c, 400, "invalid_transcript");
    }
    await store.finishLocal(m.id, t);
    return c.json(meetingJson((await ownMeeting(c))!));
  });

  /* ---------- language models: speaker names and minutes (docs/design/minutes-with-llm.md) ---------- */

  const llmRoute = async (c: C, fn: () => Promise<Response>) => {
    if (!(await deps.limits.llm.allow(`llm:${c.get("user").id}`))) return err(c, 429, "too_many");
    const work = (async () => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof MinutesError) return err(c, e.status, e.code);
        if (e instanceof LlmError) {
          // Provider, HTTP status and the provider's error code only (see LlmError).
          console.error("llm", e.code, e.message);
          return err(c, 502, `llm_${e.code}`);
        }
        console.error("llm route", (e as Error).message);
        return err(c, 500, "generic");
      }
    })();
    return keepAlive(work);
  };

  authed.post("/meetings/:id/speakers/suggest", (c) =>
    llmRoute(c, async () => c.json(await suggestSpeakers(mdeps, c.get("user"), c.req.param("id") ?? "", c.get("lang")))),
  );

  authed.post("/meetings/:id/minutes", (c) =>
    llmRoute(c, async () => c.json(minutesJson(await generateMinutes(mdeps, c.get("user"), c.req.param("id") ?? "", c.get("lang"))))),
  );

  authed.put("/meetings/:id/minutes", async (c) => {
    const m = await ownMeeting(c);
    if (!m) return err(c, 404, "not_found");
    const text = (await body<{ body: string }>(c)).body;
    if (typeof text !== "string" || !text.trim() || text.length > MAX_MINUTES) return err(c, 400, "invalid_minutes");
    if (!(await store.editMinutes(m.id, text, deps.now()))) return err(c, 404, "not_found");
    return c.json(minutesJson(await store.minutes(m.id)));
  });

  authed.delete("/meetings/:id/minutes", async (c) => {
    const m = await ownMeeting(c);
    if (!m) return err(c, 404, "not_found");
    await store.deleteMinutes(m.id);
    return c.json({ ok: true });
  });

  /* ---------- export everything (AGENTS: data leaves in an open format) ---------- */

  authed.get("/export", async (c) => {
    const user = c.get("user");
    const meetings = await store.listMeetings(user.id);
    // Transcripts are spliced in as stored text, so the export never parses them (CPU-limited hosts).
    const parts: string[] = [];
    for (const m of meetings) {
      const head = JSON.stringify({ ...meetingJson(m), audioUrl: m.audio_key ? `/api/meetings/${m.id}/audio` : null, minutes: minutesJson(await store.minutes(m.id)) });
      parts.push(`${head.slice(0, -1)},"transcript":${(await store.transcriptText(m.id)) ?? "null"}}`);
    }
    const data = JSON.stringify({
      format: "minuteca-export",
      version: 1,
      exportedAt: new Date(deps.now()).toISOString(),
      account: { email: user.email, role: user.role, provider: user.provider, consents: user.consents, languageModel: user.llmProvider, minutesInstructions: user.minutesInstructions, keys: (await store.providerKeys(user.id)).map((k) => ({ provider: k.provider, last4: k.last4 })) },
      usage: await store.usageOf(user.id),
      languageModelUsage: await store.llmUsageOf(user.id),
      meetings: [],
    });
    return new Response(`${data.slice(0, -3)}[${parts.join(",")}]}`, {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="minuteca-${new Date(deps.now()).toISOString().slice(0, 10)}.json"` },
    });
  });

  /* ---------- access list (admins) ---------- */

  const adminOnly = async (c: C, next: () => Promise<void>) => {
    if (c.get("user").role !== "admin") return err(c, 403, "not_admin");
    await next();
  };
  const usersJson = async () =>
    (await store.listUsers()).map((u) => ({
      email: u.email,
      role: u.role,
      addedBy: u.added_by,
      addedAt: new Date(u.created_at).toISOString(),
      fixed: config.adminEmails.includes(u.email),
    }));

  authed.get("/users", adminOnly, async (c) => c.json({ users: await usersJson() }));

  authed.post("/users", adminOnly, async (c) => {
    const b = await body<{ email: string; role: string }>(c);
    const email = String(b.email ?? "").trim().toLowerCase();
    const role: Role = b.role === "admin" ? "admin" : "member";
    if (!EMAIL_RE.test(email)) return err(c, 400, "invalid_email");
    if (email === c.get("user").email || config.adminEmails.includes(email)) return err(c, 400, "self");
    await store.saveUser(email, role, c.get("user").email, deps.now());
    return c.json({ users: await usersJson() });
  });

  authed.delete("/users/:email", adminOnly, async (c) => {
    const email = decodeURIComponent(c.req.param("email") ?? "").toLowerCase();
    if (email === c.get("user").email || config.adminEmails.includes(email)) return err(c, 400, "self");
    const u = await store.userByEmail(email);
    if (u) await store.removeUser(u.id);
    return c.json({ users: await usersJson() });
  });

  /* ---------- provider links (no session: the job token is the access) ---------- */

  app.on(["GET", "HEAD"], "/api/provider-audio/:id/:token", async (c) => {
    const m = await jobByToken(tdeps, c.req.param("id"), c.req.param("token"));
    if (!m?.audio_key) return err(c, 404, "not_found");
    return sendAudio(c, m.audio_key);
  });

  app.post("/api/provider-callback/:id/:token", async (c) => {
    const m = await jobByToken(tdeps, c.req.param("id"), c.req.param("token"));
    if (!m) return err(c, 404, "not_found");
    const payload = new Uint8Array(await c.req.arrayBuffer());
    if (!payload.byteLength) return err(c, 400, "invalid_body");
    await completeFromCallback(tdeps, m, payload);
    return c.json({ ok: true });
  });

  app.route("/api", authed);

  app.all("/api/*", (c) => err(c, 404, "not_found"));

  /* ---------- web app ---------- */

  app.get("*", async (c) => {
    if (!deps.assets) return c.text("minuteca API. Build the web app with `npm run build`.", 404);
    // Workers' asset responses have immutable headers; a copy lets the security headers be added.
    const r = await deps.assets(c.req.raw);
    return new Response(r.body, r);
  });

  app.onError((e, c) => {
    if (e instanceof ProviderError) return err(c, 502, e.code);
    console.error("server", e.message);
    return err(c, 500, "server_error");
  });

  return app;
}

/** Starts a transcription with the person's chosen provider if they allowed it and a key exists. */
export async function autoTranscribe(tdeps: TranscriptionDeps, userId: string, meetingId: string): Promise<void> {
  const user = await tdeps.store.userById(userId);
  if (!user || user.role === "removed" || !user.consents.includes(user.provider)) return;
  try {
    await startTranscription(tdeps, user, meetingId, { provider: user.provider });
  } catch (e) {
    // No key, cap reached, already running: the meeting stays "uploaded" for the web app to explain.
    if (!(e instanceof TranscriptionError)) console.error("auto transcription", meetingId, (e as Error).message);
  }
}

/** Retention (meetings, audio and transcripts after retentionDays), expired sign-in rows and stuck jobs. */
/**
 * Cloudflare closes a response that sends nothing for about 100 seconds, and minutes for a long meeting
 * can take longer. A quick answer goes out as is. A slow one starts at once with status 200, sends a
 * space every few seconds (JSON allows leading whitespace) and then the JSON; an error then carries
 * its real status in `errorStatus`, which the web client turns back into an error.
 */
/** A stored file with byte ranges (players and the desktop updater ask for parts). */
export async function sendFile(c: { req: { header(name: string): string | undefined }; json(body: unknown, status?: number): Response }, get: (range?: FileRange) => Promise<StoredFile | null>, extra: Record<string, string>): Promise<Response> {
  const head = await get({ offset: 0, length: 1 });
  if (!head) return c.json({ error: "not_found" }, 404);
  head.body.cancel().catch(() => {});
  const range = parseRange(c.req.header("Range"), head.size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${head.size}` } });
  const f = await get(range ?? undefined);
  if (!f) return c.json({ error: "not_found" }, 404);
  const headers = new Headers({ "Content-Type": f.contentType, "Accept-Ranges": "bytes", ...extra });
  if (f.range) {
    headers.set("Content-Range", `bytes ${f.range.offset}-${f.range.offset + f.range.length - 1}/${f.size}`);
    headers.set("Content-Length", String(f.range.length));
    return new Response(f.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(f.size));
  return new Response(f.body, { status: 200, headers });
}

export async function keepAlive(work: Promise<Response>, { after = 5_000, every = 15_000 } = {}): Promise<Response> {
  let wait: ReturnType<typeof setTimeout> | undefined;
  const quick = await Promise.race([work, new Promise<null>((resolve) => (wait = setTimeout(() => resolve(null), after)))]);
  clearTimeout(wait);
  if (quick) return quick;
  const encoder = new TextEncoder();
  let tick: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(" "));
      tick = setInterval(() => controller.enqueue(encoder.encode(" ")), every);
      work
        .then(async (res) => {
          const data = (await res.json().catch(() => ({ error: "generic" }))) as Record<string, unknown>;
          return res.ok ? data : { ...data, errorStatus: res.status };
        })
        .catch(() => ({ error: "generic", errorStatus: 500 }))
        .then((data) => {
          clearInterval(tick);
          controller.enqueue(encoder.encode(JSON.stringify(data)));
          controller.close();
        });
    },
    cancel() {
      clearInterval(tick);
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function maintenance(deps: Deps): Promise<{ deleted: number }> {
  const now = deps.now();
  let deleted = 0;
  for (;;) {
    const batch = await deps.store.expiredMeetings(now);
    for (const m of batch) {
      if (m.audio_key) await deps.files.delete(m.audio_key);
      await deps.files.delete(rawKey(m.user_id, m.id));
      await deps.store.deleteMeeting(m.user_id, m.id);
      deleted++;
    }
    if (batch.length < 100) break;
  }
  await deps.store.purgeTokens(now);
  // The usage ledger has no content, only minutes; it is kept 13 months for the yearly view.
  await deps.store.purgeUsage(monthOf(now - 396 * DAY));
  const tdeps: TranscriptionDeps = {
    store: deps.store,
    files: deps.files,
    vault: deps.vault,
    hosted: deps.hosted,
    transcribers: deps.transcribers,
    now: deps.now,
    origin: deps.config.origin,
    providerAudio: deps.config.providerAudio,
    convert: deps.config.convert,
  };
  for (const m of await deps.store.meetingsInStatus("transcribing")) await refreshJob(tdeps, m);
  return { deleted };
}
