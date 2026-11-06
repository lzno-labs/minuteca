// Default storage: SQLite through Node's built-in node:sqlite (no native dependency).
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db, Param, Row } from "./db.ts";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations/", import.meta.url));

export interface SqliteDb extends Db {
  exec(sql: string): void;
  close(): void;
}

/** @param path file path, or ":memory:" */
export function openSqlite(path: string): SqliteDb {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const norm = (params: Param[] = []) => params as SQLInputValue[];
  const plain = (row: unknown) => (row ? ({ ...(row as Row) }) : null);
  return {
    async all<T>(sql: string, params?: Param[]) {
      return db.prepare(sql).all(...norm(params)).map(plain) as T[];
    },
    async first<T>(sql: string, params?: Param[]) {
      return plain(db.prepare(sql).get(...norm(params))) as T | null;
    },
    async run(sql: string, params?: Param[]) {
      const r = db.prepare(sql).run(...norm(params));
      return { changes: Number(r.changes) };
    },
    async batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const { sql, params } of statements) db.prepare(sql).run(...norm(params));
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    exec(sql: string) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
  };
}

/**
 * Applies migrations/*.sql in order. Cloudflare uses `wrangler d1 migrations apply` with the
 * same files (and its own `d1_migrations` table), so both paths share one schema.
 */
export async function migrate(db: SqliteDb, dir = MIGRATIONS_DIR): Promise<string[]> {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const done = new Set((await db.all<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
  const applied: string[] = [];
  for (const f of readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
    if (done.has(f)) continue;
    db.exec("BEGIN");
    try {
      db.exec(readFileSync(join(dir, f), "utf8"));
      await db.run("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", [f, Date.now()]);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
    applied.push(f);
  }
  return applied;
}
