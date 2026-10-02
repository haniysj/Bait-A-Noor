import { query } from '../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    console.log('🔧 Initializing database schema...');

    const schema = `
      CREATE TABLE IF NOT EXISTS bills (
        id SERIAL PRIMARY KEY,
        year INT NOT NULL,
        month INT NOT NULL,
        category TEXT NOT NULL,
        amount DECIMAL(10,2),
        date TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(year, month, category)
      );

      CREATE TABLE IF NOT EXISTS cars (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        plate TEXT,
        sold BOOLEAN DEFAULT FALSE,
        data JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_bills_year_month ON bills(year, month);
      CREATE INDEX IF NOT EXISTS idx_cars_sold ON cars(sold);
    `;

    const statements = schema.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      if (stmt.trim()) {
        await query(stmt);
      }
    }

    console.log('✅ Schema created');

    const bills = [
      [2026, 1, 'elec', 45.50, '2026-01-28'],
      [2026, 1, 'water', 12.00, '2026-01-15'],
      [2026, 1, 'wifi', 29.99, '2026-01-01'],
      [2026, 1, 'mobile', 19.99, '2026-01-10'],
    ];

    for (const [y, m, cat, amt, dt] of bills) {
      await query(
        'INSERT INTO bills (year, month, category, amount, date) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (year, month, category) DO NOTHING',
        [y, m, cat, amt, dt]
      );
    }

    const cars = [
      ['car_1', 'Mercedes-Benz E300', 'OM-2024-001'],
      ['car_2', 'Lexus LX570', 'OM-2023-005'],
      ['car_3', 'Toyota Camry', 'OM-2022-010'],
    ];

    for (const [id, name, plate] of cars) {
      await query(
        'INSERT INTO cars (id, name, plate, data) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
        [id, name, plate, '{}']
      );
    }

    return res.status(200).json({ 
      success: true,
      message: 'Database initialized successfully'
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    return res.status(500).json({ 
      error: error.message,
      success: false 
    });
  }
}
