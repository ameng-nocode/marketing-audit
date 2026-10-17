import fs from "node:fs";
import path from "node:path";

// PGlite = real Postgres in-process, data in .data/pg. No database server to run.
// Migrations in db/migrations run once, in file order.

type Row = Record<string, unknown>;
export type Q = <T = Row>(sql: string, params?: unknown[]) => Promise<T[]>;

type Engine = {
  query: Q;
  exec: (sql: string) => Promise<void>;
  tx: <T>(fn: (q: Q) => Promise<T>) => Promise<T>;
};

const g = globalThis as unknown as { __auditDb?: Promise<Engine> };

// Timestamps come back as ISO strings (UTC), so the app never handles Date objects.
const TIMESTAMPTZ = 1184;
const TIMESTAMP = 1114;
const isoFromPg = (v: string) => new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString();
const isoFromPgLocal = (v: string) => new Date(v.replace(" ", "T") + "Z").toISOString();

async function pglite(): Promise<Engine> {
  const { PGlite } = await import("@electric-sql/pglite");
  // PGLITE_DIR lets the test copy run on its own database (see scripts/test-flow.mjs).
  const dir = path.resolve(process.cwd(), process.env.PGLITE_DIR || path.join(".data", "pg"));
  fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir, { parsers: { [TIMESTAMPTZ]: isoFromPg, [TIMESTAMP]: isoFromPgLocal } });
  await db.waitReady;
  const query: Q = async (sql, params = []) => (await db.query(sql, params)).rows as never;
  return {
    query,
    exec: async (sql) => { await db.exec(sql); },
    tx: (fn) => db.transaction(async (t) => fn(async (sql, params = []) => (await t.query(sql, params)).rows as never)),
  };
}

async function migrate(e: Engine) {
  await e.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await e.query<{ name: string }>(`select name from schema_migrations`)).map((r) => r.name));
  const dir = path.join(process.cwd(), "db", "migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await e.tx(async (q) => {
      for (const stmt of splitSql(sql)) await q(stmt);
      await q(`insert into schema_migrations (name) values ($1)`, [f]);
    });
  }
}

// Migrations are plain DDL (no functions with $$ bodies), so splitting on ";" at line ends is safe.
function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

function engine(): Promise<Engine> {
  if (!g.__auditDb) {
    g.__auditDb = (async () => {
      const e = await pglite();
      await migrate(e);
      return e;
    })().catch((err) => {
      g.__auditDb = undefined;
      throw err;
    });
  }
  return g.__auditDb;
}

export const q: Q = async (sql, params) => (await engine()).query(sql, params);
export async function tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  return (await engine()).tx(fn);
}
export async function one<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined> {
  return (await q<T>(sql, params))[0];
}
