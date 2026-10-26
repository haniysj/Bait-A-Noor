/* Bait Al Noor — bank SMS reader + expense categories.
   Shared by the app (paste box) and the server (api/expenses.js).
   Classic script: defines globalThis.BaitSMS. */
(function () {
  const CATEGORIES = [
    { key: 'food',      label: 'Food & Dining',   color: '#e0a458', words: ['KITCHEN','RESTAURANT','REST.','CAFE','COFFEE','KAFE','MCDONALD','KFC','PIZZA','BURGER','SHAWARMA','BAKERY','SWEETS','HARDEES','SUBWAY','STARBUCKS','TIM HORTONS','COSTA','DUNKIN','TALABAT','GRILL','MANDI','BIRYANI','JUICE','TEA','KARAK','FOOD','CHICKEN','DINING','MATAAM','MAT3AM'] },
    { key: 'groceries', label: 'Groceries',       color: '#5fb0a3', words: ['LULU','CARREFOUR','NESTO','AL MEERA','ALMEERA','HYPER','SUPERMARKET','SUPER MARKET','MARKET','SPAR','KM TRADING','SULTAN CENTER','SULTAN CENTRE','AL FAIR','GROCER','MINI MART','MART','ROYAL HYPER','ISTANBUL','PARIS GALLERY HYPER'] },
    { key: 'fuel',      label: 'Fuel',            color: '#d97757', words: ['SHELL ','OMAN OIL MARKETING','SHELL OMAN','OMAN OIL','OOMCO','AL MAHA','ALMAHA','PETROL','FUEL','ADNOC','FILLING','SERVICE STATION'] },
    { key: 'shopping',  label: 'Shopping',        color: '#c9a7e8', words: ['MALL','CENTREPOINT','CENTER POINT','MAX ','SPLASH','H&M','ZARA','AMAZON','NOON','SHEIN','IKEA','HOME CENTRE','HOME CENTER','ELECTRONIC','SHARAF','EXTRA','JARIR','DRAGON MART','GIFT','PERFUME','ABAYA','TAILOR','FASHION'] },
    { key: 'health',    label: 'Health',          color: '#e0715f', words: ['PHARMACY','PHARMA','HOSPITAL','CLINIC','MEDICAL','DENTAL','OPTIC','LAB '] },
    { key: 'bills',     label: 'Bills & Telecom', color: '#7fb3e0', words: ['OMANTEL','OOREDOO','VODAFONE','NAMA','ELECTRICITY','WATER','AWASR','INTERNET','RECHARGE','TOPUP','TOP UP','PREPAID','GOVERNMENT','MUNICIPALITY','ROP '] },
    { key: 'car',       label: 'Car & Transport', color: '#9fc27f', words: ['PARKING','CAR WASH','TYRE','TIRE','AUTO','GARAGE','TOYOTA','NISSAN','LEXUS','MERCEDES','AUDI','TAXI','OTAXI','MWASALAT','SALAM AIR','OMAN AIR','AIRLINE','TOLL'] },
    { key: 'other',     label: 'Other',           color: '#c9c0ae', words: [] },
  ];

  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const merchantKey = (m) => norm(m).toUpperCase();

  function categorize(merchant, rules) {
    const m = ' ' + merchantKey(merchant) + ' ';
    if (rules && rules[merchantKey(merchant)]) return rules[merchantKey(merchant)];
    let best = 'other', len = 0;                       // most specific (longest) keyword wins
    for (const c of CATEGORIES) for (const w of c.words) if (m.includes(w) && w.length > len) { best = c.key; len = w.length; }
    return best;
  }

  // "used for OMR 2.900 at AL FAIHA KITCHEN  on 24/10/2026 20:49:07"  (Bank Muscat card purchase)
  const RE_CARD = /used\s+for\s+([A-Z]{3})\s*([\d,]+(?:\.\d+)?)\s+at\s+(.+?)\s+on\s+(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?/i;
  const RE_AMT = /\b(OMR|RO|USD|AED|SAR|EUR|GBP|QAR|BHD|KWD|INR)\s*([\d,]+(?:\.\d+)?)/i;
  const RE_DATE = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/;
  const SECRET = /\b(OTP|one[\s-]?time|password|passcode|PIN|verification|code is|activation)\b/i;
  const DEBIT = /\b(used for|purchase|debited|withdrawn|withdrawal|spent|paid|payment of|POS)\b/i;
  const CREDIT = /\b(refund|reversal|reversed|credited|cashback)\b/i;

  const pad = (n) => String(n).padStart(2, '0');
  const toNum = (s) => Number(String(s).replace(/,/g, ''));
  const cardOf = (t) => { const m = /card\s*(?:no\.?|number|ending(?:\s+with)?)?\s*[:#]?\s*([*Xx\d]{4,})/i.exec(t); const d = m ? m[1].replace(/\D/g, '') : ''; return d.length >= 4 ? d.slice(-4) : ''; };

  // Drop the balance / available-limit tail before anything is stored.
  const stripTail = (t) => norm(String(t || '').split(/\b(available\s+(limit|balance|bal)|avl\.?\s*(bal|lmt|limit)|balance\s+is|bal\s*:)/i)[0]).replace(/[.\s]+$/, '');

  function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }

  /* Returns {ok:true, expense} | {ok:false, reason:'secret'|'unrecognised'|'empty'} */
  function parse(text, rules) {
    const raw = norm(text);
    if (!raw) return { ok: false, reason: 'empty' };
    if (SECRET.test(raw)) return { ok: false, reason: 'secret' };
    const clean = stripTail(raw);
    let m = RE_CARD.exec(clean), e = null;
    if (m) {
      e = { currency: m[1].toUpperCase().replace('RO', 'OMR'), amount: toNum(m[2]), merchant: norm(m[3]),
            date: `${m[6]}-${pad(m[5])}-${pad(m[4])}`, time: m[7] ? `${pad(m[7])}:${m[8]}` : '', type: 'debit' };
    } else {
      const a = RE_AMT.exec(clean), d = RE_DATE.exec(clean);
      const isCredit = CREDIT.test(clean), isDebit = DEBIT.test(clean);
      if (!a || !(isCredit || isDebit)) return { ok: false, reason: 'unrecognised' };
      const at = /\b(?:at|to|from|@)\s+(.+?)(?:\s+on\s+\d|\s+dated|\s+ref|[.,;]\s|$)/i.exec(clean.slice(a.index + a[0].length)) || /\b(?:at|to|from)\s+(.+?)(?:\s+on\s+\d|[.,;]\s|$)/i.exec(clean);
      e = { currency: a[1].toUpperCase() === 'RO' ? 'OMR' : a[1].toUpperCase(), amount: toNum(a[2]), merchant: norm(at ? at[1] : ''),
            date: d ? `${d[3]}-${pad(d[2])}-${pad(d[1])}` : '', time: d && d[4] ? `${pad(d[4])}:${d[5]}` : '', type: isCredit ? 'refund' : 'debit' };
    }
    if (!(e.amount > 0)) return { ok: false, reason: 'unrecognised' };
    e.merchant = e.merchant || (e.type === 'refund' ? 'Refund' : 'Card payment');
    e.card = cardOf(clean);
    e.category = e.type === 'refund' ? 'other' : categorize(e.merchant, rules);
    e.raw = clean;
    e.id = 'sms_' + hash(clean.toUpperCase());
    return { ok: true, expense: e };
  }

  const titleCase = (s) => norm(s).toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());

  globalThis.BaitSMS = { parse, categorize, CATEGORIES, merchantKey, titleCase, stripTail, hash };
})();
