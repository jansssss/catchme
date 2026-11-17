import { neon } from "@neondatabase/serverless";

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, any>[]>;

let _sql: Sql | null = null;
let _ready: Promise<void> | null = null;

/** 로컬 개발용: DATABASE_URL 이 없으면 파일 기반 내장 Postgres(PGlite)를 쓴다 */
function localClient(): Sql {
  const g = globalThis as any;
  g.__pglite ??= import("@electric-sql/pglite").then((m) => new m.PGlite("./.pglite"));
  return async (strings, ...values) => {
    const pg = await g.__pglite;
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""), "");
    return (await pg.query(text, values)).rows;
  };
}

function client(): Sql {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (url) _sql = neon(url) as unknown as Sql;
    else if (process.env.NODE_ENV !== "production") _sql = localClient();
    else throw new Error("DATABASE_URL 환경변수가 없습니다");
  }
  return _sql;
}

async function ensureSchema() {
  const sql = client();
  await sql`CREATE TABLE IF NOT EXISTS watchlist (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    market TEXT NOT NULL DEFAULT 'KOSPI',
    buy_price NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL REFERENCES watchlist(code) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    value NUMERIC NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    state TEXT,
    fired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS alert_log (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    price NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`;
}

/** 테이블이 없으면 만들고, 쿼리 함수를 돌려준다 */
export async function db(): Promise<Sql> {
  if (!_ready) {
    _ready = ensureSchema().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  await _ready;
  return client();
}
