// Phone notifications: hand out the public key, store / remove device subscriptions, send a test.
import webpush from 'web-push';
import { kvGet, kvSet, appKeyOk } from './_kv.js';

function configure() {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://bait-alnoor.vercel.app',
    process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
  }
  if (!appKeyOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'push not configured' });

  try {
    const body = req.body || {};
    let subs = await kvGet('push_subs', []);

    if (req.method === 'POST' && body.subscription && body.subscription.endpoint) {
      const s = body.subscription;
      subs = subs.filter(x => x.endpoint !== s.endpoint);
      subs.push({ endpoint: s.endpoint, keys: s.keys, device: String(body.device || '').slice(0, 80), added: new Date().toISOString() });
      await kvSet('push_subs', subs);
      return res.status(200).json({ ok: true, devices: subs.length });
    }

    if (req.method === 'POST' && body.test && body.endpoint) {
      configure();
      const s = subs.find(x => x.endpoint === body.endpoint);
      if (!s) return res.status(404).json({ error: 'device not registered' });
      await webpush.sendNotification(s, JSON.stringify({
        title: 'Bait Al Noor', body: 'Notifications are working on this device ✓', tag: 'test', url: '/',
      }));
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE' && body.endpoint) {
      subs = subs.filter(x => x.endpoint !== body.endpoint);
      await kvSet('push_subs', subs);
      return res.status(200).json({ ok: true, devices: subs.length });
    }

    return res.status(400).json({ error: 'bad request' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'push error' });
  }
}
