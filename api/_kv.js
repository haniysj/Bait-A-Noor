// Shared Neon helpers for the server functions (underscore = not a route).
import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
let ready = null;

export function ensureTable() {
  if (!ready) {
    ready = sql`CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`.catch(err => { ready = null; throw err; });
  }
  return ready;
}

export async function kvGet(key, fallback = null) {
  await ensureTable();
  const rows = await sql`SELECT value FROM kv WHERE key = ${key}`;
  return rows[0] ? rows[0].value : fallback;
}

export async function kvSet(key, value) {
  await ensureTable();
  await sql`INSERT INTO kv (key, value, updated_at)
            VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export const appKeyOk = (req) => !!process.env.APP_KEY && req.headers['x-app-key'] === process.env.APP_KEY;

export function muscatToday(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
