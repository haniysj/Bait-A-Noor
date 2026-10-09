// Daily job (Vercel Cron, ~08:00 Oman): send phone notifications for new alerts.
// Each alert is sent once (remembered in kv 'push_sent'); the bell in the app always shows the full list.
import webpush from 'web-push';
import '../alerts.js';
import { kvGet, kvSet, appKeyOk, muscatToday } from './_kv.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const cronOk = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (!cronOk && !appKeyOk(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    const today = muscatToday();
    const [bills, cars, appts] = await Promise.all([kvGet('bills', {}), kvGet('cars', []), kvGet('appts', [])]);
    const alerts = globalThis.BaitAlerts.computeAlerts({ bills: bills || {}, cars: cars || [], appts: appts || [], today });

    let subs = await kvGet('push_subs', []);
    const sent = await kvGet('push_sent', {});
    const fresh = alerts.filter(a => !sent[a.id]);
    const dry = req.query && req.query.dry === '1';
    let delivered = 0;

    if (!dry && fresh.length && subs.length && process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://bait-alnoor.vercel.app',
        process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
      const gone = new Set();
      for (const a of fresh.slice(0, 8)) {
        const payload = JSON.stringify({ title: a.title, body: a.body, tag: a.id, url: '/#alerts' });
        for (const s of subs) {
          try { await webpush.sendNotification(s, payload); delivered++; }
          catch (e) { if (e.statusCode === 404 || e.statusCode === 410) gone.add(s.endpoint); else console.error('push failed', e.statusCode, e.body); }
        }
        sent[a.id] = today;
      }
      if (gone.size) { subs = subs.filter(s => !gone.has(s.endpoint)); await kvSet('push_subs', subs); }
      // forget entries older than ~13 months so the list stays small
      for (const [k, d] of Object.entries(sent)) if (globalThis.BaitAlerts.daysBetween(d, today) > 400) delete sent[k];
      await kvSet('push_sent', sent);
    }

    return res.status(200).json({ today, alerts: alerts.length, fresh: fresh.length, devices: subs.length, delivered, dry });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'cron error' });
  }
}
