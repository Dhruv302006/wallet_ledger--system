import redis from '../config/redis.js';

/**
 * Acquire a distributed lock in Redis for a specific resource
 * @param {string} key - Lock identifier
 * @param {number} ttlMs - Time to live in milliseconds
 * @returns {Promise<boolean>} - True if lock acquired, false otherwise
 */
export const acquireLock = async (key, ttlMs = 5000) => {
  const lockKey = `lock:${key}`;
  const result = await redis.set(lockKey, '1', 'NX', 'PX', ttlMs);
  return result === 'OK';
};

/**
 * Release a distributed lock in Redis
 * @param {string} key - Lock identifier
 */
export const releaseLock = async (key) => {
  const lockKey = `lock:${key}`;
  await redis.del(lockKey);
};

/**
 * Get cached wallet balance
 * @param {string} walletId 
 * @returns {Promise<string|null>} - Balance as string or null
 */
export const getCachedBalance = async (walletId) => {
  return await redis.get(`balance:${walletId}`);
};

/**
 * Set cached wallet balance with TTL (e.g., 1 hour)
 * @param {string} walletId 
 * @param {string|number} balance 
 */
export const setCachedBalance = async (walletId, balance) => {
  await redis.set(`balance:${walletId}`, String(balance), 'EX', 3600);
};

/**
 * Invalidate cached wallet balance
 * @param {string} walletId 
 */
export const invalidateCachedBalance = async (walletId) => {
  await redis.del(`balance:${walletId}`);
};

/**
 * Check idempotency key status and cached response
 * @param {string} key - Idempotency key
 * @returns {Promise<{ status: 'pending'|'completed', response: any } | null>}
 */
export const checkIdempotency = async (key) => {
  const val = await redis.get(`idempotency:${key}`);
  if (!val) return null;
  
  try {
    return JSON.parse(val);
  } catch (err) {
    return { status: 'pending', response: null };
  }
};

/**
 * Set idempotency key state and optional response payload with a 24h TTL
 * @param {string} key 
 * @param {'pending'|'completed'} status 
 * @param {any} response 
 */
export const setIdempotency = async (key, status, response = null) => {
  const data = JSON.stringify({ status, response });
  await redis.set(`idempotency:${key}`, data, 'EX', 86400); // 24 hours TTL
};
