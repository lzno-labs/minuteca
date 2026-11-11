// Run minuteca on any machine: `npm run build && npm start`. SQLite database, audio on disk,
// the web app from dist/. See README.md and .env.example.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createApp, maintenance, type Deps } from "./app.ts";
import { appConfig, mailFrom } from "./config.ts";
import { diskFiles } from "./files/disk.ts";
import { diskDownloads } from "./files/downloads.ts";
import { hostedKeys } from "./hosted.ts";
import { KeyVault } from "./keys.ts";
import { memoryLimiter } from "./limits.ts";
import { migrate, openSqlite } from "./storage/sqlite.ts";
import { Store } from "./storage/store.ts";
import { transcribers } from "./transcriber/index.ts";
import { llmAdapters } from "./llm/index.ts";

const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const IP_HEADER = "x-minuteca-client-ip";
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** Files of the built web app; any other path gets index.html (single page app). */
export async function serveDist(req: Request): Promise<Response> {
  let rel = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^([/\\])+/, "");
  if (rel.includes("..")) return new Response("", { status: 400 });
  if (!rel || !extname(rel)) rel = "index.html";
  try {
    const body = await readFile(join(DIST, rel));
    const immutable = rel.startsWith("assets/");
    return new Response(body, {
      headers: {
        "Content-Type": TYPES[extname(rel)] ?? "application/octet-stream",
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  } catch {
    if (extname(rel) && rel !== "index.html") return new Response("", { status: 404 });
    return new Response("Build the web app first: npm run build", { status: 404 });
  }
}

function toRequest(req: IncomingMessage, origin: string, trustProxy: boolean): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && k !== IP_HEADER) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  // The client IP for rate limits is set here, never taken from what the client sent.
  const forwarded = trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim() : "";
  headers.set(IP_HEADER, forwarded || req.socket.remoteAddress || "unknown");
  const method = req.method ?? "GET";
  const hasBody = !["GET", "HEAD"].includes(method);
  return new Request(new URL(req.url ?? "/", origin), {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}

async function send(res: ServerResponse, r: Response, head: boolean) {
  const headers: Record<string, string | string[]> = {};
  r.headers.forEach((v, k) => {
    if (k !== "set-cookie") headers[k] = v;
  });
  const cookies = r.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(r.status, headers);
  if (head || !r.body) {
    res.end();
    return;
  }
  Readable.fromWeb(r.body as import("node:stream/web").ReadableStream).pipe(res);
}

async function main() {
  const env = process.env;
  const port = Number(env.PORT) || 8787;
  const host = env.HOST || "127.0.0.1";
  const config = appConfig(env, `http://localhost:${port}`);
  const db = openSqlite(env.MINUTECA_DB || "./data/minuteca.sqlite");
  const applied = await migrate(db);
  if (applied.length) console.log(`minuteca: applied migrations ${applied.join(", ")}`);
  const vault = KeyVault.fromEnv(env.MINUTECA_KEY_ENCRYPTION_KEY);
  if (!vault) console.log("minuteca: MINUTECA_KEY_ENCRYPTION_KEY is not set, so nobody can save a provider key (see .env.example).");
  if (!config.adminEmails.length) console.log("minuteca: MINUTECA_ADMIN_EMAILS is empty, so nobody can sign in yet (see .env.example).");
  const deps: Deps = {
    store: new Store(db),
    files: diskFiles(env.MINUTECA_FILES_DIR || "./data/files"),
    mail: mailFrom(env, "console"),
    vault,
    hosted: hostedKeys(env),
    transcribers: transcribers(),
    llm: llmAdapters(env),
    limits: { login: memoryLimiter(5, 60), token: memoryLimiter(20, 60), llm: memoryLimiter(10, 60) },
    config,
    now: Date.now,
    clientIp: (req) => req.headers.get(IP_HEADER) ?? "unknown",
    assets: serveDist,
    // Desktop installers and update feeds, when this server publishes them (ADR 0005).
    downloads: env.MINUTECA_DOWNLOADS_DIR ? diskDownloads(env.MINUTECA_DOWNLOADS_DIR) : undefined,
  };
  const app = createApp(deps);
  const trustProxy = env.TRUST_PROXY === "1";
  createServer(async (req, res) => {
    try {
      await send(res, await app.fetch(toRequest(req, config.origin, trustProxy)), req.method === "HEAD");
    } catch (err) {
      console.error("server", (err as Error).message);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
      res.end();
    }
  }).listen(port, host, () => console.log(`minuteca: listening on ${config.origin} (${host}:${port})`));

  // Retention, expired sign-in links and stuck jobs: at start and then every 10 minutes.
  const tick = () =>
    maintenance(deps)
      .then(({ deleted }) => deleted && console.log(`minuteca: deleted ${deleted} expired meeting(s)`))
      .catch((e) => console.error("maintenance", (e as Error).message));
  tick();
  setInterval(tick, 10 * 60_000).unref();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
