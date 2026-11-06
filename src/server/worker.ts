// Cloudflare Workers entry (hosted version). Bindings: DB (D1), FILES (R2), ASSETS (dist/),
// optional LOGIN_LIMITER and TOKEN_LIMITER (rate limiting). Secrets: MINUTECA_KEY_ENCRYPTION_KEY,
// RESEND_API_KEY, and whatever hosted.ts reads. A cron trigger runs maintenance().
import { createApp, maintenance, type Deps } from "./app.ts";
import { appConfig, mailFrom, type EnvVars } from "./config.ts";
import { r2Files, type R2Like } from "./files/r2.ts";
import { hostedKeys } from "./hosted.ts";
import { KeyVault } from "./keys.ts";
import { cloudflareLimiter, memoryLimiter, type CloudflareRateLimit } from "./limits.ts";
import { d1Db, type D1Like } from "./storage/d1.ts";
import { Store } from "./storage/store.ts";
import { transcribers } from "./transcriber/index.ts";

type Bindings = {
  DB: D1Like;
  FILES: R2Like;
  ASSETS?: { fetch(req: Request): Promise<Response> };
  LOGIN_LIMITER?: CloudflareRateLimit;
  TOKEN_LIMITER?: CloudflareRateLimit;
};
type WorkerEnv = EnvVars & Bindings;

let cached: { app: ReturnType<typeof createApp>; deps: Deps } | undefined;

function setup(env: WorkerEnv, origin: string) {
  if (cached) return cached;
  const deps: Deps = {
    store: new Store(d1Db(env.DB)),
    files: r2Files(env.FILES),
    mail: mailFrom(env, "resend"),
    vault: KeyVault.fromEnv(env.MINUTECA_KEY_ENCRYPTION_KEY as string | undefined),
    hosted: hostedKeys(env),
    transcribers: transcribers(),
    limits: {
      login: env.LOGIN_LIMITER ? cloudflareLimiter(env.LOGIN_LIMITER) : memoryLimiter(5, 60),
      token: env.TOKEN_LIMITER ? cloudflareLimiter(env.TOKEN_LIMITER) : memoryLimiter(20, 60),
    },
    // Workers Free allows 10 ms of CPU per request: provider answers are converted in the browser.
    config: appConfig(env, origin, "client"),
    now: Date.now,
    clientIp: (req) => req.headers.get("CF-Connecting-IP") ?? "unknown",
    assets: env.ASSETS ? (req) => env.ASSETS!.fetch(req) : undefined,
  };
  cached = { app: createApp(deps), deps };
  return cached;
}

export default {
  fetch(request: Request, env: WorkerEnv) {
    return setup(env, new URL(request.url).origin).app.fetch(request);
  },
  async scheduled(_event: unknown, env: WorkerEnv) {
    const { deleted } = await maintenance(setup(env, String(env.MINUTECA_ORIGIN ?? "http://localhost")).deps);
    if (deleted) console.log("meetings deleted by retention", deleted);
  },
};
