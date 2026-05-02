// config/database.js — PostgreSQL connection pool (Supabase-ready)
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }   // Required for Supabase
    : { rejectUnauthorized: false },  // Also use SSL in dev with Supabase
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// Parameterised query wrapper — prevents SQL injection
const query = async (text, params) => {
  const start = Date.now();
  const result = await pool.query(text, params);
  const ms = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DB] ${ms}ms | ${result.rowCount} rows | ${text.slice(0, 60)}...`);
  }
  return result;
};

// Client for multi-statement transactions
const getClient = () => pool.connect();

const testConnection = async () => {
  try {
    const r = await pool.query('SELECT NOW() AS time, version() AS ver');
    console.log('[DB] Connected to PostgreSQL ✓');
    console.log(`[DB] Server time: ${r.rows[0].time}`);
    return true;
  } catch (e) {
    console.error('[DB] Connection failed:', e.message);
    return false;
  }
};

module.exports = { query, getClient, testConnection, pool };
