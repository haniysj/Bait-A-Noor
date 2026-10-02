import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (error) {
    console.error('DB Error:', error);
    throw error;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { route } = req.query;

  try {
    // Initialize DB
    if (route === 'init-db') {
      const schema = `
        CREATE TABLE IF NOT EXISTS bills (id SERIAL PRIMARY KEY, year INT, month INT, category TEXT, amount DECIMAL, date TEXT, UNIQUE(year, month, category));
        CREATE TABLE IF NOT EXISTS cars (id TEXT PRIMARY KEY, name TEXT, plate TEXT, sold BOOLEAN DEFAULT FALSE, data JSONB DEFAULT '{}');
        CREATE INDEX IF NOT EXISTS idx_bills_ym ON bills(year, month);
      `;
      const statements = schema.split(';').filter(s => s.trim());
      for (const stmt of statements) {
        if (stmt.trim()) await query(stmt);
      }
      
      const bills = [[2026, 1, 'elec', 45.50, '2026-01-28'], [2026, 1, 'water', 12.00, '2026-01-15']];
      for (const [y, m, c, a, d] of bills) {
        await query('INSERT INTO bills (year, month, category, amount, date) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [y, m, c, a, d]);
      }
      
      return res.json({ success: true, message: 'Database initialized' });
    }

    // Get Bills
    if (route === 'bills' && req.method === 'GET') {
      const result = await query('SELECT * FROM bills ORDER BY year DESC, month DESC');
      return res.json(result.rows);
    }

    // Save Bill
    if (route === 'bills' && req.method === 'POST') {
      const { year, month, category, amount, date } = req.body;
      const result = await query(
        'INSERT INTO bills (year, month, category, amount, date) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (year, month, category) DO UPDATE SET amount = $4 RETURNING *',
        [year, month, category, amount, date]
      );
      return res.json(result.rows[0]);
    }

    // Get Cars
    if (route === 'cars' && req.method === 'GET') {
      const result = await query('SELECT * FROM cars ORDER BY created_at DESC');
      return res.json(result.rows);
    }

    return res.status(400).json({ error: 'Unknown route' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
