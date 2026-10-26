// Expenses: bank SMS webhook (from the phone automation) + list/add/edit/delete for the app.
import '../sms.js';
import crypto from 'node:crypto';
import { kvGet, kvSet, appKeyOk } from './_kv.js';

const P = () => globalThis.BaitSMS;
const MAX_UNPARSED = 20;

function smsKeyOk(req) {
  const k = process.env.SMS_KEY;
  if (!k) return false;
  const given = (req.query && req.query.key) || req.headers['x-sms-key'] || '';
  const a = Buffer.from(String(given)), b = Buffer.from(k);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readText(req) {
  const b = req.body;
  if (typeof b === 'string') return b;
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  if (b && typeof b === 'object') return String(b.text || b.message || b.sms || b.msg || b.body || '');
  if (req.query && req.query.text) return String(req.query.text);
  try { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks).toString('utf8'); } catch { return ''; }
}

const clampItem = (x) => ({
  id: String(x.id || ('m_' + crypto.randomUUID().slice(0, 12))),
  date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : '',
  time: /^\d{2}:\d{2}$/.test(x.time || '') ? x.time : '',
  amount: Math.round(Math.abs(Number(x.amount) || 0) * 1000) / 1000,
  currency: /^[A-Z]{3}$/.test(x.currency || '') ? x.currency : 'OMR',
  merchant: String(x.merchant || '').slice(0, 80),
  type: x.type === 'refund' ? 'refund' : 'debit',
  category: P().CATEGORIES.some((c) => c.key === x.category) ? x.category : 'other',
  catManual: !!x.catManual,
  card: String(x.card || '').replace(/\D/g, '').slice(-4),
  source: ['sms', 'paste', 'manual'].includes(x.source) ? x.source : 'manual',
  note: String(x.note || '').slice(0, 200),
  raw: x.raw ? String(x.raw).slice(0, 400) : undefined,
  added: x.added || new Date().toISOString(),
});

async function addParsed(text, source) {
  const [items, rules] = await Promise.all([kvGet('expenses', []), kvGet('exp_rules', {})]);
  const r = P().parse(text, rules || {});
  if (!r.ok) {
    if (r.reason === 'unrecognised' && /\b(OMR|RO)\b/i.test(text)) {   // keep for review (never OTP / secret messages)
      const un = await kvGet('exp_unparsed', []);
      const clean = P().stripTail(text);
      const id = 'u_' + P().hash(clean.toUpperCase());
      if (!un.some((u) => u.id === id)) {
        un.unshift({ id, text: clean.slice(0, 400), at: new Date().toISOString() });
        await kvSet('exp_unparsed', un.slice(0, MAX_UNPARSED));
      }
    }
    return { ok: true, added: false, reason: r.reason };
  }
  if (items.some((x) => x.id === r.expense.id)) return { ok: true, added: false, reason: 'duplicate', expense: r.expense };
  const item = clampItem({ ...r.expense, source });
  items.push(item);
  await kvSet('expenses', items);
  return { ok: true, added: true, expense: item };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    // 1) Phone automation → POST /api/expenses?key=SMS_KEY with the SMS text as the body
    if (req.method === 'POST' && smsKeyOk(req)) {
      const text = await readText(req);
      return res.status(200).json(await addParsed(text, 'sms'));
    }
    if (!appKeyOk(req)) return res.status(401).json({ error: 'unauthorized' });

    if (req.method === 'GET') {
      const [items, unparsed, rules] = await Promise.all([kvGet('expenses', []), kvGet('exp_unparsed', []), kvGet('exp_rules', {})]);
      const out = { items, unparsed, rules };
      if (req.query && req.query.setup === '1') {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        out.webhook = process.env.SMS_KEY ? `https://${host}/api/expenses?key=${encodeURIComponent(process.env.SMS_KEY)}` : null;
      }
      return res.status(200).json(out);
    }

    const body = (req.body && typeof req.body === 'object') ? req.body : {};

    if (req.method === 'POST' && typeof body.text === 'string') {          // paste an SMS in the app
      return res.status(200).json(await addParsed(body.text, 'paste'));
    }
    if (req.method === 'POST' && body.item) {                               // manual add
      const items = await kvGet('expenses', []);
      const item = clampItem({ ...body.item, id: undefined, source: 'manual', catManual: true });
      if (!item.amount || !item.date) return res.status(400).json({ error: 'amount and date are required' });
      items.push(item); await kvSet('expenses', items);
      if (body.dismissUnparsed) { const un = await kvGet('exp_unparsed', []); await kvSet('exp_unparsed', un.filter((u) => u.id !== body.dismissUnparsed)); }
      return res.status(200).json({ ok: true, item });
    }
    if (req.method === 'PUT' && Array.isArray(body.replaceAll)) {           // restore from backup
      await kvSet('expenses', body.replaceAll.map(clampItem));
      return res.status(200).json({ ok: true, count: body.replaceAll.length });
    }
    if (req.method === 'PUT' && body.id && body.patch) {                   // edit one
      const items = await kvGet('expenses', []);
      const i = items.findIndex((x) => x.id === body.id);
      if (i < 0) return res.status(404).json({ error: 'not found' });
      const next = clampItem({ ...items[i], ...body.patch, id: items[i].id, source: items[i].source, added: items[i].added });
      let changedOthers = 0;
      if (body.patch.category && body.patch.category !== items[i].category) {
        next.catManual = true;
        const key = P().merchantKey(next.merchant);
        if (key) {                                                          // remember for this merchant
          const rules = await kvGet('exp_rules', {}); rules[key] = next.category; await kvSet('exp_rules', rules);
          items.forEach((x, j) => { if (j !== i && !x.catManual && P().merchantKey(x.merchant) === key && x.type === 'debit') { x.category = next.category; changedOthers++; } });
        }
      }
      items[i] = next; await kvSet('expenses', items);
      return res.status(200).json({ ok: true, item: next, changedOthers });
    }
    if (req.method === 'DELETE' && body.id) {
      const items = await kvGet('expenses', []);
      await kvSet('expenses', items.filter((x) => x.id !== body.id));
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE' && body.unparsedId) {
      const un = await kvGet('exp_unparsed', []);
      await kvSet('exp_unparsed', un.filter((u) => u.id !== body.unparsedId));
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'bad request' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
}
