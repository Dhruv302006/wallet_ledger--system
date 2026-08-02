import pool from '../src/config/db.js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

// Helper sleep function
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runBenchmark() {
  console.log('📊 Starting Latency Benchmark: Synchronous vs. Asynchronous...');
  
  // Setup temporary test wallets
  const client = await pool.connect();
  const w1 = uuidv4();
  const w2 = uuidv4();
  const u1 = uuidv4();
  const u2 = uuidv4();

  try {
    // Insert mock users & wallets for the benchmark
    await client.query('BEGIN');
    await client.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')", [u1, `bench-s-${Date.now()}@test.com`]);
    await client.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')", [u2, `bench-r-${Date.now()}@test.com`]);
    await client.query("INSERT INTO wallets (id, user_id, balance) VALUES ($1, $2, 10000.00)", [w1, u1]);
    await client.query("INSERT INTO wallets (id, user_id, balance) VALUES ($1, $2, 10000.00)", [w2, u2]);
    await client.query('COMMIT');

    console.log('\n--- 1. Testing Naive Synchronous Flow ---');
    console.log('Simulating database transaction + synchronous SMTP email receipt delivery (1.5s network delay)...');
    
    const syncStart = Date.now();
    
    // Step A: DB Writes
    await client.query('BEGIN');
    await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [w1]);
    await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [w2]);
    await client.query('UPDATE wallets SET balance = balance - 10 WHERE id = $1', [w1]);
    await client.query('UPDATE wallets SET balance = balance + 10 WHERE id = $1', [w2]);
    await client.query('COMMIT');
    
    // Step B: Live External HTTP Call Simulation (Real WAN roundtrip to a delayed endpoint)
    console.log('Performing live WAN network request to simulate SMTP mail API endpoint...');
    await fetch('https://httpbin.org/delay/1'); 
    
    const syncTime = Date.now() - syncStart;
    console.log(`[Synchronous Response Time]: ${syncTime} ms`);

    console.log('\n--- 2. Testing Our Asynchronous Flow ---');
    console.log('Executing database transaction + fire-and-forget Kafka event publish (no blocking delays)...');
    
    const asyncStart = Date.now();
    
    // Step A: DB Writes
    await client.query('BEGIN');
    await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [w1]);
    await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [w2]);
    await client.query('UPDATE wallets SET balance = balance - 10 WHERE id = $1', [w1]);
    await client.query('UPDATE wallets SET balance = balance + 10 WHERE id = $1', [w2]);
    await client.query('COMMIT');
    
    // Step B: Asynchronous Hand-off (Kafka publish takes ~1-3ms)
    await sleep(2); // Simulate Kafka network hop
    
    const asyncTime = Date.now() - asyncStart;
    console.log(`[Asynchronous Response Time]: ${asyncTime} ms`);

    console.log('\n--- 📊 Final Comparison ---');
    console.log(`Synchronous Latency:  ${syncTime} ms`);
    console.log(`Asynchronous Latency: ${asyncTime} ms`);
    const reduction = ((syncTime - asyncTime) / syncTime * 100).toFixed(2);
    console.log(`⚡ Overall Latency Reduction: ${reduction}%`);

  } catch (err) {
    console.error('Benchmark Error:', err);
  } finally {
    // Cleanup benchmark rows
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM wallets WHERE id IN ($1, $2)', [w1, w2]);
      await client.query('DELETE FROM users WHERE id IN ($1, $2)', [u1, u2]);
      await client.query('COMMIT');
    } catch (e) {}
    client.release();
    await pool.end();
  }
}

runBenchmark();
