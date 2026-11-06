// Settings from environment variables (see .env.example). Nothing secret has a default.
import { consoleMail, resendMail, type Mail } from "./mail/mail.ts";

export type EnvVars = Record<string, string | undefined>;

export interface Config {
  /** Public address, without a trailing slash. Cookie-authenticated writes are accepted only from it. */
  origin: string;
  coreSha: string;
  retentionDays: number;
  /** Largest audio upload, in bytes. */
  maxAudioBytes: number;
  /** Emails that are always on the access list, as admins. */
  adminEmails: string[];
  providerAudio: "url" | "upload";
  convert: "server" | "client";
}

export const DEFAULT_MAX_AUDIO_MB = 95; // under the 100 MB request limit of Cloudflare's free plan

export function appConfig(env: EnvVars, fallbackOrigin: string, defaultConvert: "server" | "client" = "server"): Config {
  const origin = (env.MINUTECA_ORIGIN || fallbackOrigin).replace(/\/$/, "");
  const local = /^http:\/\/(localhost|127\.|\[::1\])/.test(origin) || !origin.startsWith("https://");
  const providerAudio = env.MINUTECA_PROVIDER_AUDIO === "url" || env.MINUTECA_PROVIDER_AUDIO === "upload" ? env.MINUTECA_PROVIDER_AUDIO : local ? "upload" : "url";
  return {
    origin,
    coreSha: env.LZNO_CORE_SHA || "dev",
    retentionDays: Math.max(1, Math.min(365, Number(env.MINUTECA_RETENTION_DAYS) || 30)),
    maxAudioBytes: Math.max(1, Number(env.MINUTECA_MAX_AUDIO_MB) || DEFAULT_MAX_AUDIO_MB) * 1024 * 1024,
    adminEmails: (env.MINUTECA_ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    providerAudio,
    convert: env.MINUTECA_CONVERT === "client" || env.MINUTECA_CONVERT === "server" ? env.MINUTECA_CONVERT : defaultConvert,
  };
}

/** MAIL_PROVIDER: "console" prints sign-in links (local default); "resend" sends them. */
export function mailFrom(env: EnvVars, defaultProvider: "console" | "resend"): Mail {
  const provider = env.MAIL_PROVIDER || defaultProvider;
  if (provider === "console") return consoleMail();
  if (provider === "resend") {
    const key = env.RESEND_API_KEY;
    const from = env.MAIL_FROM;
    if (!key || !from) {
      return {
        send: async () => {
          throw new Error("mail: RESEND_API_KEY and MAIL_FROM are required with MAIL_PROVIDER=resend");
        },
      };
    }
    return resendMail(key, from);
  }
  throw new Error(`unknown MAIL_PROVIDER ${provider}`);
}
