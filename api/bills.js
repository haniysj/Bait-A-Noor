import { query } from '../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const { year, month } = req.query;
      let sql = 'SELECT * FROM bills ORDER BY year DESC, month DESC';
      let params = [];
      
      if (year && month) {
        sql = 'SELECT * FROM bills WHERE year = $1 AND month = $2';
        params = [year, month];
      }
      
      const result = await query(sql, params);
      return res.status(200).json(result.rows);
    }

    if (req.method === 'POST') {
      const { year, month, category, amount, date } = req.body;
      const sql = `
        INSERT INTO bills (year, month, category, amount, date)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (year, month, category) DO UPDATE SET amount = $4, date = $5, updated_at = NOW()
        RETURNING *
      `;
      const result = await query(sql, [year, month, category, amount, date || null]);
      return res.status(201).json(result.rows[0]);
    }

    if (req.method === 'DELETE') {
      const { year, month, category } = req.body;
      const sql = 'DELETE FROM bills WHERE year = $1 AND month = $2 AND category = $3 RETURNING *';
      const result = await query(sql, [year, month, category]);
      return res.status(200).json(result.rows[0]);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
