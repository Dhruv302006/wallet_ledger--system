import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import staticPlugin from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { runMigrations } from './db/migrate.js';
import pool from './config/db.js';
import redis from './config/redis.js';
import authRoutes from './routes/auth.routes.js';
import walletRoutes from './routes/wallet.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import { startWorkers, stopWorkers } from './workers/index.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger: true,
});

// Register Core Security & Cookie Plugins
await fastify.register(cookie);
await fastify.register(cors, {
  origin: true, // Allow dev sources
  credentials: true,
});
await fastify.register(helmet, {
  contentSecurityPolicy: false, // Turned off for easy local dashboard injection
});

// Serve Frontend Static Files
await fastify.register(staticPlugin, {
  root: path.join(__dirname, 'public'),
  prefix: '/',
});

// Configure Rate Limiter (Backed by Redis)
await fastify.register(rateLimit, {
  max: 10000,
  timeWindow: '1 minute',
  redis: redis,
  keyGenerator: (request) => {
    return request.user?.userId || request.ip;
  },
});

// Register API Routes
fastify.register(authRoutes, { prefix: '/api/auth' });
fastify.register(walletRoutes, { prefix: '/api/wallet' });
fastify.register(analyticsRoutes, { prefix: '/api/analytics' });

// Health Check Endpoint
fastify.get('/health', async (request, reply) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    postgres: 'down',
    redis: 'down',
  };

  try {
    const dbCheck = await pool.query('SELECT 1');
    if (dbCheck.rows.length > 0) health.postgres = 'up';
  } catch (err) {
    health.status = 'unhealthy';
    fastify.log.error('Healthcheck DB Error:', err);
  }

  try {
    const redisCheck = await redis.ping();
    if (redisCheck === 'PONG') health.redis = 'up';
  } catch (err) {
    health.status = 'unhealthy';
    fastify.log.error('Healthcheck Redis Error:', err);
  }

  if (health.status === 'unhealthy') {
    return reply.status(500).send(health);
  }
  return reply.send(health);
});

// Start Server & Infrastructure
const start = async () => {
  const port = process.env.PORT || 3000;
  
  try {
    // 1. Run migrations
    await runMigrations();

    // 2. Start Kafka Workers in background for developer convenience (unless explicitly disabled)
    if (process.env.START_WORKERS !== 'false') {
      // Small timeout to give Kafka time to boot up if containers just launched
      setTimeout(() => {
        startWorkers();
      }, 5000);
    }

    // 3. Listen on port
    await fastify.listen({ port: port, host: '0.0.0.0' });
    console.log(`🚀 API Server listening on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful Shutdown
const shutdown = async () => {
  console.log('\nShutting down gracefully...');
  try {
    await fastify.close();
    await pool.end();
    await redis.quit();
    if (process.env.START_WORKERS !== 'false') {
      await stopWorkers();
    }
    console.log('Server and databases closed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
