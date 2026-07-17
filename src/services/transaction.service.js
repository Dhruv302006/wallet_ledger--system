import pool from '../config/db.js';
import redis from '../config/redis.js';
import * as cacheService from './cache.service.js';
import * as kafkaService from './kafka.service.js';

/**
 * Execute a transfer from source wallet to destination wallet.
 * This is the high-performance, concurrent-safe core transaction engine.
 */
export const transfer = async (idempotencyKey, sourceWalletId, destinationWalletId, amountVal, currency = 'INR') => {
  const amount = parseFloat(amountVal);
  if (isNaN(amount) || amount <= 0) {
    throw new Error('Invalid transfer amount');
  }

  if (sourceWalletId === destinationWalletId) {
    throw new Error('Source and destination wallets must be different');
  }

  // 1. Idempotency Check (Redis)
  const idemRecord = await cacheService.checkIdempotency(idempotencyKey);
  if (idemRecord) {
    if (idemRecord.status === 'pending') {
      throw new Error('Transaction is already being processed');
    }
    // Replay completed response
    return idemRecord.response;
  }

  // Set idempotency key as pending in Redis
  await cacheService.setIdempotency(idempotencyKey, 'pending');

  // 2. Acquire Redis distributed locks (fail fast for concurrent clicks on source wallet)
  // We lock the source wallet to prevent double-spending race conditions before they even hit the database.
  const lockAcquired = await cacheService.acquireLock(`wallet:${sourceWalletId}`, 5000);
  if (!lockAcquired) {
    await cacheService.setIdempotency(idempotencyKey, 'completed', { error: 'Concurrent transaction in progress. Please retry.' });
    throw new Error('Concurrent transaction in progress. Please retry.');
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // 3. Prevent Deadlocks: Sort UUIDs lexicographically to guarantee consistent lock ordering
    const sortedIds = [sourceWalletId, destinationWalletId].sort();
    const walletsMap = {};

    for (const id of sortedIds) {
      const lockRes = await client.query(
        'SELECT * FROM wallets WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (lockRes.rows.length === 0) {
        throw new Error(`Wallet not found: ${id}`);
      }
      walletsMap[id] = lockRes.rows[0];
    }

    const sourceWallet = walletsMap[sourceWalletId];
    const destinationWallet = walletsMap[destinationWalletId];

    // 4. Input & Balance Validations
    if (sourceWallet.status !== 'active') {
      throw new Error('Source wallet is frozen or inactive');
    }
    if (destinationWallet.status !== 'active') {
      throw new Error('Destination wallet is frozen or inactive');
    }
    if (sourceWallet.currency !== currency || destinationWallet.currency !== currency) {
      throw new Error(`Currency mismatch. This transfer requires ${currency}`);
    }
    
    const sourceBalance = parseFloat(sourceWallet.balance);
    const destBalance = parseFloat(destinationWallet.balance);

    if (sourceBalance < amount) {
      throw new Error('Insufficient balance');
    }

    // 5. Update Balances & Write to database
    const newSourceBalance = sourceBalance - amount;
    const newDestBalance = destBalance + amount;

    // Update Wallets
    await client.query(
      'UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newSourceBalance, sourceWalletId]
    );
    await client.query(
      'UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newDestBalance, destinationWalletId]
    );

    // Create Transaction Entry
    const txRes = await client.query(
      `INSERT INTO transactions (idempotency_key, source_wallet_id, destination_wallet_id, amount, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [idempotencyKey, sourceWalletId, destinationWalletId, amount, currency, 'completed']
    );
    const transaction = txRes.rows[0];

    // Create Ledger Entries (Debit & Credit)
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, wallet_id, entry_type, amount, balance_after)
       VALUES ($1, $2, $3, $4, $5)`,
      [transaction.id, sourceWalletId, 'debit', amount, newSourceBalance]
    );
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, wallet_id, entry_type, amount, balance_after)
       VALUES ($1, $2, $3, $4, $5)`,
      [transaction.id, destinationWalletId, 'credit', amount, newDestBalance]
    );

    await client.query('COMMIT');

    // 6. Write-Through cache update (Redis)
    await cacheService.setCachedBalance(sourceWalletId, newSourceBalance.toFixed(4));
    await cacheService.setCachedBalance(destinationWalletId, newDestBalance.toFixed(4));

    // 7. Publish to Kafka (Asynchronous)
    const eventPayload = {
      event_type: 'TransactionCompleted',
      transaction_id: transaction.id,
      idempotency_key: idempotencyKey,
      source_wallet_id: sourceWalletId,
      destination_wallet_id: destinationWalletId,
      amount,
      currency,
      timestamp: transaction.created_at,
    };
    
    // We run it as background task, so API doesn't wait for Kafka network ACK
    kafkaService.publishTransactionEvent(eventPayload);

    // 8. Cache response payload in Redis
    const responsePayload = {
      success: true,
      transaction_id: transaction.id,
      source_wallet_id: sourceWalletId,
      destination_wallet_id: destinationWalletId,
      amount,
      currency,
      new_balance: newSourceBalance.toFixed(4),
      created_at: transaction.created_at,
    };

    await cacheService.setIdempotency(idempotencyKey, 'completed', responsePayload);
    return responsePayload;
  } catch (error) {
    await client.query('ROLLBACK');

    // For logical errors (e.g., Insufficient balance), we log the transaction as failed in the DB
    if (
      error.message === 'Insufficient balance' ||
      error.message.includes('frozen') ||
      error.message.includes('not found')
    ) {
      try {
        const failedTxRes = await pool.query(
          `INSERT INTO transactions (idempotency_key, source_wallet_id, destination_wallet_id, amount, currency, status, error_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (idempotency_key) DO UPDATE SET status = 'failed', error_reason = $7
           RETURNING id, created_at`,
          [idempotencyKey, sourceWalletId, destinationWalletId, amount, currency, 'failed', error.message]
        );
        
        const responsePayload = { success: false, error: error.message };
        await cacheService.setIdempotency(idempotencyKey, 'completed', responsePayload);
      } catch (dbErr) {
        console.error('Failed to log failed transaction in DB:', dbErr);
      }
    } else {
      // For system errors (e.g. database down), we delete the idempotency key in Redis so the client can retry.
      await redis.del(`idempotency:${idempotencyKey}`);
    }

    throw error;
  } finally {
    client.release();
    // Release locks
    await cacheService.releaseLock(`wallet:${sourceWalletId}`);
  }
};

/**
 * Handle external deposit/injection of money
 */
export const deposit = async (idempotencyKey, walletId, amountVal, currency = 'INR') => {
  const amount = parseFloat(amountVal);
  if (isNaN(amount) || amount <= 0) {
    throw new Error('Invalid deposit amount');
  }

  // Idempotency check
  const idemRecord = await cacheService.checkIdempotency(idempotencyKey);
  if (idemRecord) {
    if (idemRecord.status === 'pending') throw new Error('Transaction in progress');
    return idemRecord.response;
  }

  await cacheService.setIdempotency(idempotencyKey, 'pending');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Row Lock
    const lockRes = await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [walletId]);
    if (lockRes.rows.length === 0) throw new Error('Wallet not found');
    const wallet = lockRes.rows[0];

    if (wallet.status !== 'active') throw new Error('Wallet is inactive');
    if (wallet.currency !== currency) throw new Error('Currency mismatch');

    const newBalance = parseFloat(wallet.balance) + amount;

    // Update Wallet Balance
    await client.query(
      'UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newBalance, walletId]
    );

    // Create transaction
    const txRes = await client.query(
      `INSERT INTO transactions (idempotency_key, destination_wallet_id, amount, currency, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [idempotencyKey, walletId, amount, currency, 'completed']
    );
    const transaction = txRes.rows[0];

    // Ledger Entry (Credit Only)
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, wallet_id, entry_type, amount, balance_after)
       VALUES ($1, $2, $3, $4, $5)`,
      [transaction.id, walletId, 'credit', amount, newBalance]
    );

    await client.query('COMMIT');

    // Cache Update
    await cacheService.setCachedBalance(walletId, newBalance.toFixed(4));

    // Kafka Event
    kafkaService.publishTransactionEvent({
      event_type: 'DepositCompleted',
      transaction_id: transaction.id,
      idempotency_key: idempotencyKey,
      destination_wallet_id: walletId,
      amount,
      currency,
      timestamp: transaction.created_at
    });

    const responsePayload = {
      success: true,
      transaction_id: transaction.id,
      destination_wallet_id: walletId,
      amount,
      new_balance: newBalance.toFixed(4),
      created_at: transaction.created_at
    };

    await cacheService.setIdempotency(idempotencyKey, 'completed', responsePayload);
    return responsePayload;
  } catch (error) {
    await client.query('ROLLBACK');
    await redis.del(`idempotency:${idempotencyKey}`);
    throw error;
  } finally {
    client.release();
  }
};
