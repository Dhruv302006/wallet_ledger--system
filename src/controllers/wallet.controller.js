import * as walletService from '../services/wallet.service.js';
import * as transactionService from '../services/transaction.service.js';

/**
 * Controller endpoint to retrieve the current balance of the authenticated user's wallet.
 */
export const getBalance = async (request, reply) => {
  try {
    const wallet = await walletService.getWalletByUserId(request.user.userId);
    if (!wallet) {
      return reply.status(404).send({ error: 'Wallet not found' });
    }
    const balance = await walletService.getBalance(wallet.id);
    return reply.send({ wallet_id: wallet.id, balance, currency: wallet.currency });
  } catch (error) {
    return reply.status(500).send({ error: error.message });
  }
};

/**
 * Controller endpoint to fetch paginated historical ledger logs for the authenticated user's wallet.
 */
export const getHistory = async (request, reply) => {
  const limit = parseInt(request.query.limit) || 20;
  const offset = parseInt(request.query.offset) || 0;
  
  try {
    const wallet = await walletService.getWalletByUserId(request.user.userId);
    if (!wallet) {
      return reply.status(404).send({ error: 'Wallet not found' });
    }
    const history = await walletService.getHistory(wallet.id, limit, offset);
    return reply.send({ wallet_id: wallet.id, history });
  } catch (error) {
    return reply.status(500).send({ error: error.message });
  }
};

/**
 * Controller endpoint to deposit mock funds into the authenticated user's wallet.
 * Requires a unique Idempotency-Key header to prevent duplicate deposit executions.
 */
export const depositFunds = async (request, reply) => {
  const { amount, currency } = request.body;
  const idempotencyKey = request.headers['idempotency-key'];
 
  if (!idempotencyKey) {
    return reply.status(400).send({ error: 'Idempotency-Key header is required for deposits' });
  }
 
  if (!amount || amount <= 0) {
    return reply.status(400).send({ error: 'Amount must be positive' });
  }
 
  try {
    const wallet = await walletService.getWalletByUserId(request.user.userId);
    if (!wallet) {
      return reply.status(404).send({ error: 'Wallet not found' });
    }

    const result = await transactionService.deposit(
      idempotencyKey,
      wallet.id,
      amount,
      currency || 'INR'
    );
    return reply.send(result);
  } catch (error) {
    return reply.status(400).send({ error: error.message });
  }
};

/**
 * Controller endpoint to execute a secure transfer of funds to another user.
 * Validates parameters, translates email to wallet ID, and delegates execution
 * to the transactional lock-preventing transfer engine.
 * Requires a unique Idempotency-Key header.
 */
export const transferFunds = async (request, reply) => {
  const { destination_email, amount, currency } = request.body;
  const idempotencyKey = request.headers['idempotency-key'];
 
  if (!idempotencyKey) {
    return reply.status(400).send({ error: 'Idempotency-Key header is required for transfers' });
  }
 
  if (!destination_email) {
    return reply.status(400).send({ error: 'Destination email is required' });
  }
 
  if (!amount || amount <= 0) {
    return reply.status(400).send({ error: 'Amount must be positive' });
  }
 
  try {
    // 1. Get source wallet
    const sourceWallet = await walletService.getWalletByUserId(request.user.userId);
    if (!sourceWallet) {
      return reply.status(404).send({ error: 'Source wallet not found' });
    }

    // 2. Find destination user & wallet
    // We fetch user by email first
    const destUserRes = await poolQuery('SELECT id FROM users WHERE email = $1', [destination_email]);
    if (destUserRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Destination user not found' });
    }
    const destUserId = destUserRes.rows[0].id;

    const destWallet = await walletService.getWalletByUserId(destUserId);
    if (!destWallet) {
      return reply.status(404).send({ error: 'Destination wallet not found' });
    }

    // 3. Execute transfer
    const result = await transactionService.transfer(
      idempotencyKey,
      sourceWallet.id,
      destWallet.id,
      amount,
      currency || 'INR'
    );

    if (result.success === false) {
      return reply.status(400).send(result);
    }

    return reply.send(result);
  } catch (error) {
    return reply.status(400).send({ error: error.message });
  }
};

// Helper for database queries inside controllers
import pool from '../config/db.js';
/**
 * Local helper to execute raw queries using the connection pool.
 */
const poolQuery = (text, params) => pool.query(text, params);
