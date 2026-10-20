// Car documents (ownership PDF). Stored separately from the car list so normal syncing stays small.
import { kvGet, kvSet, sql, ensureTable, appKeyOk } from './_kv.js';

const MAX_B64 = 4_300_000; // ≈ 3 MB PDF (Vercel request/response limit is 4.5 MB)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!appKeyOk(req)) return res.status(401).json({ error: 'unauthorized' });
  const car = String((req.query && req.query.car) || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(car)) return res.status(400).json({ error: 'bad car id' });
  const key = `doc:own:${car}`;

  try {
    if (req.method === 'GET') {
      const doc = await kvGet(key, null);
      if (!doc) return res.status(404).json({ error: 'not found' });
      return res.status(200).json(doc);
    }
    if (req.method === 'PUT') {
      const { name, data } = req.body || {};
      if (typeof data !== 'string' || !data.startsWith('JVBER')) return res.status(400).json({ error: 'not a PDF' });
      if (data.length > MAX_B64) return res.status(413).json({ error: 'file too large' });
      const doc = { name: String(name || 'ownership.pdf').slice(0, 120), type: 'application/pdf',
                    size: Math.floor(data.length * 3 / 4), uploadedAt: new Date().toISOString(), data };
      await kvSet(key, doc);
      return res.status(200).json({ ok: true, name: doc.name, size: doc.size, uploadedAt: doc.uploadedAt });
    }
    if (req.method === 'DELETE') {
      await ensureTable();
      await sql`DELETE FROM kv WHERE key = ${key}`;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'database error' });
  }
}
