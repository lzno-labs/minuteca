// Cloudflare Workers entry (hosted version). Bindings: DB (D1), FILES (R2), ASSETS (dist/),
// optional LOGIN_LIMITER and TOKEN_LIMITER (rate limiting). Secrets: MINUTECA_KEY_ENCRYPTION_KEY,
// RESEND_API_KEY, and whatever hosted.ts reads. maintenance() runs from a cron trigger when the
// account has one free, and from requests in any case (see fetch below).
import { createApp, maintenance, type Deps } from "./app.ts";
import { appConfig, mailFrom, type EnvVars } from "./config.ts";
import { r2Downloads } from "./files/downloads.ts";
import { r2Files, type R2Like } from "./files/r2.ts";
import { hostedKeys } from "./hosted.ts";
import { KeyVault } from "./keys.ts";
import { cloudflareLimiter, memoryLimiter, type CloudflareRateLimit } from "./limits.ts";
import { d1Db, type D1Like } from "./storage/d1.ts";
import { Store } from "./storage/store.ts";
import { transcribers } from "./transcriber/index.ts";
import { llmAdapters } from "./llm/index.ts";

type Bindings = {
  DB: D1Like;
  FILES: R2Like;
  ASSETS?: { fetch(req: Request): Promise<Response> };
  LOGIN_LIMITER?: CloudflareRateLimit;
  TOKEN_LIMITER?: CloudflareRateLimit;
  /** Optional bucket with the desktop installers and update feeds (ADR 0005). */
  DOWNLOADS?: R2Like;
};
type WorkerEnv = EnvVars & Bindings;

let cached: { app: ReturnType<typeof createApp>; deps: Deps } | undefined;

/** The part of the Workers ExecutionContext used here. */
interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Workers Free allows 5 cron triggers per account and they can all be taken, so requests also run
 * maintenance, at most once an hour per isolate and after the response. Daily health checks keep it
 * running when nobody uses the app; R2's lifecycle rule deletes audio after 32 days regardless.
 */
const MAINTENANCE_EVERY_MS = 60 * 60 * 1000;
let lastMaintenance = 0;

async function runMaintenance(deps: Deps) {
  try {
    const { deleted } = await maintenance(deps);
    if (deleted) console.log("meetings deleted by retention", deleted);
  } catch (e) {
    console.error("maintenance", (e as Error).message);
  }
}

function setup(env: WorkerEnv, origin: string) {
  if (cached) return cached;
  const deps: Deps = {
    store: new Store(d1Db(env.DB)),
    files: r2Files(env.FILES),
    mail: mailFrom(env, "resend"),
    vault: KeyVault.fromEnv(env.MINUTECA_KEY_ENCRYPTION_KEY as string | undefined),
    hosted: hostedKeys(env),
    transcribers: transcribers(),
    llm: llmAdapters(env),
    limits: {
      login: env.LOGIN_LIMITER ? cloudflareLimiter(env.LOGIN_LIMITER) : memoryLimiter(5, 60),
      token: env.TOKEN_LIMITER ? cloudflareLimiter(env.TOKEN_LIMITER) : memoryLimiter(20, 60),
      llm: env.TOKEN_LIMITER ? cloudflareLimiter(env.TOKEN_LIMITER) : memoryLimiter(10, 60),
    },
    // Workers Free allows 10 ms of CPU per request: provider answers are converted in the browser.
    config: appConfig(env, origin, "client"),
    now: Date.now,
    clientIp: (req) => req.headers.get("CF-Connecting-IP") ?? "unknown",
    assets: env.ASSETS ? (req) => env.ASSETS!.fetch(req) : undefined,
    downloads: env.DOWNLOADS ? r2Downloads(env.DOWNLOADS) : undefined,
  };
  cached = { app: createApp(deps), deps };
  return cached;
}

export default {
  fetch(request: Request, env: WorkerEnv, ctx?: Ctx) {
    const { app, deps } = setup(env, new URL(request.url).origin);
    const now = Date.now();
    if (ctx && now - lastMaintenance >= MAINTENANCE_EVERY_MS) {
      lastMaintenance = now;
      ctx.waitUntil(runMaintenance(deps));
    }
    return app.fetch(request);
  },
  async scheduled(_event: unknown, env: WorkerEnv) {
    lastMaintenance = Date.now();
    await runMaintenance(setup(env, String(env.MINUTECA_ORIGIN ?? "http://localhost")).deps);
  },
};
