// Pure helpers for the desktop app (docs/design/desktop-app.md). No Electron imports, so they are
// tested in Node with the rest of the repo.
import { createHash, randomBytes } from "node:crypto";

export const DEFAULT_SERVER = "https://minuteca.lzno.app";

/** The server the app shows: https, or http only on this computer (development and self-hosting). */
export function serverOrigin(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  try {
    const u = new URL(input.trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

const base64Url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The app's secret for one sign-in (ADR 0003): only its hash goes with the link request. */
export function newVerifier(): string {
  return base64Url(randomBytes(32));
}

export function challengeOf(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

/** The sign-in token from minuteca://acceso?t=…, or null for anything else. */
export function accessToken(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "minuteca:" || (u.hostname || u.pathname.replace(/^\/+/, "")) !== "acceso") return null;
    const t = u.searchParams.get("t") ?? "";
    return /^[0-9a-f]{64}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** The first minuteca:// link among a process's arguments (Windows opens links in a new process). */
export function linkInArgs(argv: readonly string[]): string | null {
  return argv.find((a) => a.startsWith("minuteca://")) ?? null;
}

/** Meeting ids are UUIDs made by the web; anything else never reaches a URL. */
export const isMeetingId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id);

/** Where the window may go: only its own server. Everything else opens in the browser. */
export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** Links the browser may open for the person: web pages and mail only. */
export function externalAllowed(url: string): boolean {
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Decoded audio travels between processes as 16-bit PCM: half the size of floats. */
export function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

export function toFloat32(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! / 32768;
  return out;
}

/** Errors the web shows (errors.<code> in locales); anything unknown becomes "generic". */
export const LOCAL_ERRORS = new Set(["cancelled", "signed_out", "network", "decode_failed", "models_failed", "engine_failed", "not_ready", "not_found", "invalid_transcript", "too_many", "mail_failed", "invalid_email"]);
export const errorCode = (code: unknown): string => (typeof code === "string" && LOCAL_ERRORS.has(code) ? code : "generic");
