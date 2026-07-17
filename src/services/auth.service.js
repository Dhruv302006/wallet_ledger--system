import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt';
const REFRESH_JWT_SECRET = process.env.REFRESH_JWT_SECRET || 'super-secret-refresh';

/**
 * Registers a new user, hashes their password, sets up a default active INR wallet
 * seeded with ₹10,000, and writes matching double-entry ledger entries for the balance.
 * Executes all database writes within a single PostgreSQL ACID transaction.
 * @param {string} email 
 * @param {string} password 
 * @returns {Promise<{ user: object, wallet: object }>}
 */
export const registerUser = async (email, password) => {
  const hashedPassword = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 1. Create User
    const userRes = await client.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, role',
      [email, hashedPassword]
    );
    const user = userRes.rows[0];
    
    // 2. Initialize Wallet with default balance (e.g. 10000.00 INR for testing)
    const walletRes = await client.query(
      'INSERT INTO wallets (user_id, currency, balance) VALUES ($1, $2, $3) RETURNING id, balance',
      [user.id, 'INR', 10000.0000]
    );
    const wallet = walletRes.rows[0];
    
    // 3. Create initial deposit ledger entry for the default balance
    // This maintains double entry ledger consistency even for default registration balances!
    const txRes = await client.query(
      `INSERT INTO transactions (idempotency_key, destination_wallet_id, amount, currency, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`signup-bonus-${user.id}`, wallet.id, 10000.0000, 'INR', 'completed']
    );
    const transactionId = txRes.rows[0].id;
    
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, wallet_id, entry_type, amount, balance_after)
       VALUES ($1, $2, $3, $4, $5)`,
      [transactionId, wallet.id, 'credit', 10000.0000, 10000.0000]
    );

    await client.query('COMMIT');
    return { user, wallet };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new Error('Email already registered');
    }
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Authenticates a user by validating their email and hashed password.
 * Retrieves their wallet and generates a new pair of access and refresh JWT tokens.
 * @param {string} email 
 * @param {string} password 
 * @returns {Promise<{ user: object, wallet: object, accessToken: string, refreshToken: string }>}
 */
export const loginUser = async (email, password) => {
  const res = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (res.rows.length === 0) {
    throw new Error('Invalid email or password');
  }
  
  const user = res.rows[0];
  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    throw new Error('Invalid email or password');
  }
  
  // Get wallet
  const walletRes = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [user.id]);
  const wallet = walletRes.rows[0];

  const tokens = await generateTokens(user.id, user.role);
  return {
    user: { id: user.id, email: user.email, role: user.role },
    wallet: wallet ? { id: wallet.id, currency: wallet.currency, balance: wallet.balance } : null,
    ...tokens
  };
};

/**
 * Generates an access token (expires in 15m) and a refresh token (expires in 7d).
 * Stores the refresh token in the database to track active user sessions.
 * @param {string} userId 
 * @param {string} role 
 * @returns {Promise<{ accessToken: string, refreshToken: string }>}
 */
export const generateTokens = async (userId, role) => {
  const accessToken = jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId }, REFRESH_JWT_SECRET, { expiresIn: '7d' });
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  
  // Store refresh token
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, refreshToken, expiresAt]
  );
  
  return { accessToken, refreshToken };
};

/**
 * Rotates a refresh token by verifying it, checking for reuse attacks, and issuing
 * a new pair of access/refresh tokens. Revokes the old token.
 * Enforces security by revoking ALL sessions for a user if reuse of an old token is detected.
 * @param {string} oldRefreshToken 
 * @returns {Promise<{ accessToken: string, refreshToken: string }>}
 */
export const refreshSession = async (oldRefreshToken) => {
  let decoded;
  try {
    decoded = jwt.verify(oldRefreshToken, REFRESH_JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired refresh token');
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Check if old token is revoked or doesn't exist
    const tokenRes = await client.query(
      'SELECT * FROM refresh_tokens WHERE token = $1 FOR UPDATE',
      [oldRefreshToken]
    );
    
    if (tokenRes.rows.length === 0 || tokenRes.rows[0].revoked) {
      // Refresh Token Reuse Detected! Revoke all tokens for this user as a security safeguard.
      if (tokenRes.rows.length > 0) {
        await client.query(
          'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1',
          [tokenRes.rows[0].user_id]
        );
      }
      await client.query('COMMIT');
      throw new Error('Security Alert: Refresh token reuse detected');
    }
    
    const dbToken = tokenRes.rows[0];
    
    // Check expiration
    if (new Date(dbToken.expires_at) < new Date()) {
      throw new Error('Refresh token has expired');
    }
    
    // Revoke old token
    await client.query(
      'UPDATE refresh_tokens SET revoked = true WHERE id = $1',
      [dbToken.id]
    );
    
    // Get user details
    const userRes = await client.query('SELECT role FROM users WHERE id = $1', [dbToken.user_id]);
    const role = userRes.rows[0]?.role || 'user';
    
    // Generate new pair
    const accessToken = jwt.sign({ userId: dbToken.user_id, role }, JWT_SECRET, { expiresIn: '15m' });
    const newRefreshToken = jwt.sign({ userId: dbToken.user_id }, REFRESH_JWT_SECRET, { expiresIn: '7d' });
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    // Store new refresh token
    await client.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [dbToken.user_id, newRefreshToken, expiresAt]
    );
    
    await client.query('COMMIT');
    return { accessToken, refreshToken: newRefreshToken };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Logs out a session by revoking (marking revoked=true) the provided refresh token in the database.
 * @param {string} refreshToken 
 */
export const logoutSession = async (refreshToken) => {
  await pool.query('UPDATE refresh_tokens SET revoked = true WHERE token = $1', [refreshToken]);
};
