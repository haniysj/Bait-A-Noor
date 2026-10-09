/* Bait Al Noor — alert rules shared by the app (bell / notifications centre)
   and the daily server job (api/cron.js → phone notifications).
   Classic script: defines globalThis.BaitAlerts. */
(function () {
  const MONTHS = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const BILL_CATS = [
    { key: 'elec', label: 'Electricity' },
    { key: 'water', label: 'Water' },
    { key: 'wifi', label: 'Wi-Fi' },
    { key: 'mobile', label: 'Mobile' },
  ];
  const REMIND_OPTIONS = [
    { v: '0d', label: 'On the day' },
    { v: '1d', label: '1 day before' },
    { v: '2d', label: '2 days before' },
    { v: '3d', label: '3 days before' },
    { v: '1w', label: '1 week before' },
    { v: '2w', label: '2 weeks before' },
    { v: '1m', label: '1 month before' },
    { v: 'date', label: 'On a specific date…' },
  ];
  const TIRE_MONTHS = 24;     // tyres: alert 2 years after the last change
  const INSURANCE_DAYS = 7;   // insurance: alert 1 week before expiry
  const BILL_DUE_DAY = 15;    // bills: unpaid if still empty on the 15th of the next month

  const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const toN = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const toISO = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  const daysBetween = (a, b) => toN(b) - toN(a);
  const dmy = (iso) => isISO(iso) ? iso.split('-').reverse().join('/') : '';
  function addMonths(iso, k) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + k, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(d, last));
    return t.toISOString().slice(0, 10);
  }
  const relDay = (n) => n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
  const filled = (v) => v !== null && v !== undefined && v !== '';

  function remindDateOf(a) {
    if (!a || !isISO(a.date)) return null;
    const r = a.remind || '1d';
    if (r === 'date') return isISO(a.remindDate) ? a.remindDate : a.date;
    const m = /^(\d+)([dwm])$/.exec(r);
    if (!m) return a.date;
    const n = Number(m[1]);
    if (m[2] === 'd') return toISO(toN(a.date) - n);
    if (m[2] === 'w') return toISO(toN(a.date) - 7 * n);
    return addMonths(a.date, -n);
  }
  function remindLabel(a) {
    const o = REMIND_OPTIONS.find(x => x.v === (a.remind || '1d'));
    if ((a.remind || '1d') === 'date') return 'On ' + dmy(remindDateOf(a));
    return o ? o.label : '';
  }

  function computeAlerts({ bills = {}, cars = [], appts = [], today }) {
    const out = [];
    if (!isISO(today)) return out;

    // 1) Appointments: from the reminder date until the appointment day
    (appts || []).forEach(a => {
      if (!a || !isISO(a.date)) return;
      const rd = remindDateOf(a);
      const left = daysBetween(today, a.date);
      if (left < 0 || daysBetween(rd, today) < 0) return;
      out.push({
        id: `appt:${a.id}:${a.date}:${rd}`, type: 'appt', ref: a.id,
        level: left === 0 ? 'warn' : 'info', sort: a.date,
        title: `Appointment ${relDay(left)}: ${a.subject || 'Appointment'}`,
        body: [dmy(a.date), a.time, a.place].filter(Boolean).join(' · '),
      });
    });

    (cars || []).forEach(car => {
      if (!car || car.sold) return;
      // 2) Insurance: 1 week before expiry (and once expired)
      const ins = (car.insurance || []).filter(x => isISO(x.expiry)).sort((p, q) => toN(q.expiry) - toN(p.expiry))[0];
      if (ins) {
        const left = daysBetween(today, ins.expiry);
        if (left <= INSURANCE_DAYS) {
          out.push({
            id: `ins:${car.id}:${ins.expiry}`, type: 'insurance', ref: car.id,
            level: left < 0 ? 'danger' : 'warn', sort: ins.expiry,
            title: left < 0 ? `Insurance expired — ${car.name}` : `Insurance expires ${relDay(left)} — ${car.name}`,
            body: `Insurance until: ${dmy(ins.expiry)}`,
          });
        }
      }
      // 3) Tyres: 2 years after the last tyre change (no newer tyre record)
      const tire = (car.tires || []).filter(x => isISO(x.date)).sort((p, q) => toN(q.date) - toN(p.date))[0];
      if (tire) {
        const due = addMonths(tire.date, TIRE_MONTHS);
        if (daysBetween(due, today) >= 0) {
          out.push({
            id: `tire:${car.id}:${tire.date}`, type: 'tires', ref: car.id,
            level: 'warn', sort: due,
            title: `Tyres are 2 years old — ${car.name}`,
            body: `Last change: ${dmy(tire.date)}. Add the new tyres in Cars → Tires once replaced.`,
          });
        }
      }
    });

    // 4) Bills: still empty on the 15th of the following month (last 3 due months)
    const [ty, tm, td] = today.split('-').map(Number);
    for (let k = (td >= BILL_DUE_DAY ? 1 : 2), n = 0; n < 3; k++, n++) {
      const t = new Date(Date.UTC(ty, tm - 1 - k, 1));
      const y = String(t.getUTCFullYear()), mi = t.getUTCMonth();
      const rec = (bills[y] || {})[MONTHS[mi]] || {};
      const missing = BILL_CATS.filter(c => !filled(rec[c.key]));
      if (!missing.length) continue;
      const dueISO = toISO(Date.UTC(t.getUTCFullYear(), mi + 1, BILL_DUE_DAY) / 86400000);
      out.push({
        id: `bill:${y}-${String(mi + 1).padStart(2, '0')}`, type: 'bill', ref: { year: y, month: MONTHS[mi] },
        level: 'danger', sort: dueISO,
        title: `Unpaid bills — ${MONTH_NAMES[mi]} ${y}`,
        body: `${missing.map(c => c.label).join(', ')} not entered. Due by ${dmy(dueISO)}.`,
      });
    }

    const rank = { danger: 0, warn: 1, info: 2 };
    return out.sort((a, b) => (rank[a.level] - rank[b.level]) || (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  }

  globalThis.BaitAlerts = { computeAlerts, remindDateOf, remindLabel, REMIND_OPTIONS, dmy, daysBetween, addMonths };
})();
