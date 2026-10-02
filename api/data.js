import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
const KEYS = ['bills', 'cars'];
let ready = null;

function ensureTable() {
  if (!ready) {
    ready = sql`CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`.catch(err => { ready = null; throw err; });
  }
  return ready;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!process.env.APP_KEY || req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    await ensureTable();

    if (req.method === 'GET') {
      const key = req.query.key;
      if (!KEYS.includes(key)) return res.status(400).json({ error: 'bad key' });
      const rows = await sql`SELECT value, updated_at FROM kv WHERE key = ${key}`;
      return res.status(200).json({ value: rows[0]?.value ?? null, updatedAt: rows[0]?.updated_at ?? null });
    }

    if (req.method === 'PUT') {
      const { key, value } = req.body || {};
      if (!KEYS.includes(key) || value === undefined) return res.status(400).json({ error: 'bad body' });
      await sql`INSERT INTO kv (key, value, updated_at)
                VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'database error' });
  }
}
