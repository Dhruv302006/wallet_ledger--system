import redis from '../config/redis.js';
import pool from '../config/db.js';

/**
 * Controller endpoint to retrieve aggregated system metrics.
 * Fetches real-time transaction count and volume from Redis,
 * and fetches connection statistics directly from the database connection pool.
 */
export const getMetrics = async (request, reply) => {
  try {
    const totalTransactions = await redis.get('analytics:total_transactions') || '0';
    const totalVolume = await redis.get('analytics:total_volume') || '0';
    const dailyVolume = await redis.hgetall('analytics:daily_volume') || {};

    const dbStats = {
      total_connections: pool.totalCount,
      idle_connections: pool.idleCount,
      waiting_clients: pool.waitingCount,
    };

    return reply.send({
      total_transactions: parseInt(totalTransactions, 10),
      total_volume: parseFloat(totalVolume),
      daily_volume: dailyVolume,
      db_connections: dbStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return reply.status(500).send({ error: error.message });
  }
};
