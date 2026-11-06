// Cloudflare D1 adapter. Generic: no account or database IDs here (those live in the
// deployment's wrangler.toml).
import type { Db, Param } from "./db.ts";

/** The part of the D1Database binding this adapter uses. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
      run(): Promise<{ meta: { changes?: number } }>;
    };
  };
  batch(statements: unknown[]): Promise<unknown[]>;
}

export function d1Db(d1: D1Like): Db {
  const bind = (sql: string, params: Param[] = []) => d1.prepare(sql).bind(...params);
  return {
    async all<T>(sql: string, params?: Param[]) {
      return (await bind(sql, params).all<T>()).results ?? [];
    },
    async first<T>(sql: string, params?: Param[]) {
      return (await bind(sql, params).first<T>()) ?? null;
    },
    async run(sql, params) {
      const r = await bind(sql, params).run();
      return { changes: r.meta.changes ?? 0 };
    },
    async batch(statements) {
      if (statements.length) await d1.batch(statements.map(({ sql, params }) => bind(sql, params)));
    },
  };
}
