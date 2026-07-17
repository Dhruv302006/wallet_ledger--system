import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50, // Higher connection pool size for high concurrency
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export default pool;
/**
 * Utility helper to execute a database query using the connection pool.
 * Automatically leases a client, runs the query, and releases it back to the pool.
 */
export const query = (text, params) => pool.query(text, params);
