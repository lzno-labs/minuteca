/**
 * The storage boundary. The core talks to SQL through this small interface so the same code
 * runs on SQLite (default, any machine) and on Cloudflare D1 (hosted version).
 */
export type Row = Record<string, unknown>;
export type Param = string | number | null | Uint8Array;
export interface Statement {
  sql: string;
  params?: Param[];
}

export interface Db {
  all<T = Row>(sql: string, params?: Param[]): Promise<T[]>;
  first<T = Row>(sql: string, params?: Param[]): Promise<T | null>;
  run(sql: string, params?: Param[]): Promise<{ changes: number }>;
  /** Runs the statements in one transaction. */
  batch(statements: Statement[]): Promise<void>;
}
