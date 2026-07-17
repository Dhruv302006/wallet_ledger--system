import pool from '../config/db.js';
import * as cacheService from './cache.service.js';

/**
 * Creates a new wallet row in PostgreSQL for a user and registers an empty balance cache in Redis.
 * @param {string} userId 
 * @param {string} currency 
 * @returns {Promise<object>} - Wallet row details
 */
export const createWallet = async (userId, currency = 'INR') => {
  const res = await pool.query(
    'INSERT INTO wallets (user_id, currency, balance) VALUES ($1, $2, 0.0000) RETURNING *',
    [userId, currency]
  );
  const wallet = res.rows[0];
  await cacheService.setCachedBalance(wallet.id, '0.0000');
  return wallet;
};

/**
 * Finds a user's wallet by their user ID and currency code.
 * @param {string} userId 
 * @param {string} currency 
 * @returns {Promise<object|null>} - Wallet details or null if not found
 */
export const getWalletByUserId = async (userId, currency = 'INR') => {
  const res = await pool.query(
    'SELECT * FROM wallets WHERE user_id = $1 AND currency = $2',
    [userId, currency]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0];
};

/**
 * Retrieves the current balance of a wallet.
 * Uses a read-through cache strategy: checks Redis first, then queries PostgreSQL on cache miss.
 * @param {string} walletId 
 * @returns {Promise<string>} - Balance value
 */
export const getBalance = async (walletId) => {
  // Try Redis cache first
  const cachedVal = await cacheService.getCachedBalance(walletId);
  if (cachedVal !== null) {
    return cachedVal;
  }

  // Cache miss, read from DB
  const res = await pool.query('SELECT balance FROM wallets WHERE id = $1', [walletId]);
  if (res.rows.length === 0) {
    throw new Error('Wallet not found');
  }

  const balance = res.rows[0].balance;
  
  // Populate Redis cache
  await cacheService.setCachedBalance(walletId, balance);
  return balance;
};

/**
 * Fetches the historical ledger entries for a specific wallet, including transaction metadata.
 * Supports pagination via limit and offset.
 * @param {string} walletId 
 * @param {number} limit 
 * @param {number} offset 
 * @returns {Promise<Array>} - List of ledger and transaction objects
 */
export const getHistory = async (walletId, limit = 50, offset = 0) => {
  const res = await pool.query(
    `SELECT le.id, le.transaction_id, le.entry_type, le.amount, le.balance_after, le.created_at,
            t.source_wallet_id, t.destination_wallet_id, t.status
     FROM ledger_entries le
     JOIN transactions t ON le.transaction_id = t.id
     WHERE le.wallet_id = $1
     ORDER BY le.id DESC
     LIMIT $2 OFFSET $3`,
    [walletId, limit, offset]
  );
  return res.rows;
};
