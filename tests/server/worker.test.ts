import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import worker from "../../src/server/worker.ts";
import { MIGRATIONS_DIR } from "../../src/server/storage/sqlite.ts";
import type { D1Like } from "../../src/server/storage/d1.ts";
import type { R2Like } from "../../src/server/files/r2.ts";

/** A D1 binding backed by node:sqlite, enough for the adapter. */
function fakeD1(db: DatabaseSync): D1Like {
  const bound = (sql: string, values: unknown[]) => {
    const stmt = () => db.prepare(sql);
    const args = values as never[];
    return {
      all: async <T>() => ({ results: stmt().all(...args) as T[] }),
      first: async <T>() => (stmt().get(...args) as T | undefined) ?? null,
      run: async () => ({ meta: { changes: Number(stmt().run(...args).changes) } }),
    };
  };
  return {
    prepare: (sql) => ({ bind: (...values) => bound(sql, values) }),
    batch: async (statements) => Promise.all((statements as ReturnType<typeof bound>[]).map((s) => s.run())),
  };
}

describe("Worker", () => {
  it("runs maintenance from requests, at most once an hour, after the response", async () => {
    const db = new DatabaseSync(":memory:");
    for (const f of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(MIGRATIONS_DIR + f, "utf8"));
    db.exec("INSERT INTO users (id, email, created_at) VALUES ('user0001', 'ana@example.org', 0)");
    const expired = (id: string) =>
      db.exec(`INSERT INTO meetings (id, user_id, title, date, created_at, expires_at, audio_key) VALUES ('${id}', 'user0001', 't', '2026-01-01', 0, 1, 'audio/user0001/${id}')`);
    const deletedFiles: string[] = [];
    const files: R2Like = { put: async () => null, get: async () => null, delete: async (k) => void deletedFiles.push(k) };
    const env = { DB: fakeD1(db), FILES: files, MINUTECA_ORIGIN: "https://minuteca.test" } as unknown as Parameters<typeof worker.fetch>[1];
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
    const count = () => (db.prepare("SELECT COUNT(*) AS n FROM meetings").get() as { n: number }).n;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
      expired("meeting01");
      const res = await worker.fetch(new Request("https://minuteca.test/health"), env, ctx);
      expect(res.status).toBe(200);
      await Promise.all(waits);
      expect(count()).toBe(0);
      expect(deletedFiles).toContain("audio/user0001/meeting01");

      expired("meeting02");
      vi.setSystemTime(new Date("2026-11-10T12:30:00Z"));
      await worker.fetch(new Request("https://minuteca.test/health"), env, ctx);
      expect(waits).toHaveLength(1);
      expect(count()).toBe(1);

      vi.setSystemTime(new Date("2026-11-10T13:00:01Z"));
      await worker.fetch(new Request("https://minuteca.test/health"), env, ctx);
      await Promise.all(waits);
      expect(waits).toHaveLength(2);
      expect(count()).toBe(0);
    } finally {
      vi.useRealTimers();
      db.close();
    }
  });
});
