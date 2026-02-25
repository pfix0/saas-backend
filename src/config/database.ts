/**
 * ساس — Database Configuration (PostgreSQL on Railway)
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// Railway provides DATABASE_URL automatically
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Log connection
pool.on('connect', () => {
  console.log('✅ Database connected');
});

pool.on('error', (err) => {
  console.error('❌ Database error:', err.message);
});

// Query helper
export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

// Single row
export async function queryOne<T = any>(
  text: string,
  params?: any[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

// Insert helper
export async function insert<T = any>(
  table: string,
  data: Record<string, any>
): Promise<T> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`);

  const text = `
    INSERT INTO ${table} (${keys.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *
  `;

  const rows = await query<T>(text, values);
  return rows[0];
}

// Update helper
export async function update<T = any>(
  table: string,
  id: string,
  data: Record<string, any>
): Promise<T | null> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClauses = keys.map((key, i) => `${key} = $${i + 1}`);

  const text = `
    UPDATE ${table}
    SET ${setClauses.join(', ')}
    WHERE id = $${keys.length + 1}
    RETURNING *
  `;

  const rows = await query<T>(text, [...values, id]);
  return rows[0] || null;
}

export { pool };
export default pool;
