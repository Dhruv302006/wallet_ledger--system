import pool from '../src/config/db.js';
import redis from '../src/config/redis.js';
import { runMigrations } from '../src/db/migrate.js';

/**
 * Utility script to clean slate database and cache for testing.
 * Flushes all Redis keys and runs the Postgres schema migrations to drop and recreate all tables.
 */
async function clearData() {
  console.log('🧹 Clearing system data for testing...');
  
  try {
    // 1. Flush Redis cache, locks, and idempotency store
    console.log('Flushing Redis cache...');
    await redis.flushall();
    console.log('✔ Redis flushed.');

    // 2. Re-run database migrations (this drops all tables and rebuilds schemas)
    await runMigrations();
    console.log('✔ PostgreSQL database reinitialized.');

    console.log('\n✨ Database and Redis cache cleared successfully! Ready for fresh tests.');
  } catch (error) {
    console.error('✖ Error clearing data:', error);
  } finally {
    // Close connections
    try {
      await pool.end();
      await redis.quit();
    } catch (e) {}
    process.exit(0);
  }
}

clearData();
