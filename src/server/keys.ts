/**
 * Each person's own provider keys (docs/design/own-provider-keys.md).
 *
 * Keys are encrypted with AES-256-GCM under one server key (MINUTECA_KEY_ENCRYPTION_KEY, a
 * secret of the deployment). The associated data binds a ciphertext to its owner and provider,
 * so a row copied to another person or provider does not decrypt. Plain keys never leave the
 * server, are never logged and are never returned: only their last 4 characters are.
 */
import { fromBase64, toBase64 } from "./crypto.ts";
import { PROVIDERS, type Provider } from "./transcriber/transcriber.ts";

export const KEY_VERSION = 1;

export interface SealedKey {
  ciphertext: string;
  iv: string;
  last4: string;
  version: number;
}

export class KeyVault {
  #key: Promise<CryptoKey>;

  private constructor(raw: Uint8Array) {
    this.#key = crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  /** null when the server key is missing: then nobody can save their own key. */
  static fromEnv(base64: string | undefined): KeyVault | null {
    if (!base64) return null;
    let raw: Uint8Array;
    try {
      raw = fromBase64(base64.trim());
    } catch {
      throw new Error("MINUTECA_KEY_ENCRYPTION_KEY must be base64 (openssl rand -base64 32)");
    }
    if (raw.length !== 32) throw new Error("MINUTECA_KEY_ENCRYPTION_KEY must be 32 bytes in base64 (openssl rand -base64 32)");
    return new KeyVault(raw);
  }

  async seal(userId: string, provider: Provider, plain: string): Promise<SealedKey> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(userId, provider) }, await this.#key, new TextEncoder().encode(plain));
    return { ciphertext: toBase64(new Uint8Array(ct)), iv: toBase64(iv), last4: plain.slice(-4), version: KEY_VERSION };
  }

  async open(userId: string, provider: Provider, sealed: Pick<SealedKey, "ciphertext" | "iv">): Promise<string> {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(sealed.iv) as BufferSource, additionalData: aad(userId, provider) },
      await this.#key,
      fromBase64(sealed.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  }
}

function aad(userId: string, provider: Provider): BufferSource {
  return new TextEncoder().encode(`minuteca:provider-key:v${KEY_VERSION}:${userId}:${provider}`);
}

/** Shape check only (the provider confirms the key itself before it is saved). */
export function plausibleKey(provider: string, key: unknown): key is string {
  return (PROVIDERS as readonly string[]).includes(provider) && typeof key === "string" && /^[\x21-\x7e]{16,300}$/.test(key);
}
