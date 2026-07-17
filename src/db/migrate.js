import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Reads the schema initialization SQL file (init.sql) and executes it against the
 * database pool. Drops existing tables and recreates them, setting up a clean schema.
 */
export const runMigrations = async () => {
  const sqlPath = path.join(__dirname, 'init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Running database migrations...');
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('Database migrations completed successfully.');
  } catch (error) {
    console.error('Error running migrations:', error);
    throw error;
  } finally {
    client.release();
  }
};
