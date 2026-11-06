// Small crypto helpers on Web Crypto, available in Node 22 and in Workers.
const enc = new TextEncoder();

export const toHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const toBase64Url = (bytes: Uint8Array): string => toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function sha256(data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(data)));
}

export async function sha256Hex(data: string): Promise<string> {
  return toHex(await sha256(data));
}

/** 32 random bytes in hex: sign-in links, sessions, provider links. Only their hash is stored. */
export const randomToken = (bytes = 32): string => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

export const TOKEN_RE = /^[0-9a-f]{64}$/;

/**
 * PKCE style check for the iOS app (docs/adr/0003-access.md): the app keeps a random verifier
 * and sends only base64url(SHA-256(verifier)) with its sign-in request.
 */
export async function challengeMatches(verifier: string, challenge: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) return false;
  return toBase64Url(await sha256(verifier)) === challenge;
}
