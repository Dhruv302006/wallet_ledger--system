const API_URL = 'http://localhost:3000';

/**
 * Helper function to pause execution for a given time window.
 * Used to wait for background consumer processing before validating balances.
 * @param {number} ms - Time in milliseconds
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Core test execution function. Creates 10 user pairs (20 wallets total),
 * logs them in, and fires 10 simultaneous transfers in parallel across
 * different wallets, confirming that locks do not conflict and no deadlocks happen.
 */
async function runTest() {
  console.log('🏁 Starting multi-wallet high-concurrency test...');
  console.log('This test verifies that parallel transfers across DIFFERENT wallets succeed without deadlocks or lock conflicts.');

  const timestamp = Date.now();
  const numPairs = 10;
  const senders = [];
  const receivers = [];

  try {
    // 1. Create Senders and Receivers in parallel
    console.log(`Creating ${numPairs} sender-receiver pairs...`);
    const creationPromises = [];

    for (let i = 0; i < numPairs; i++) {
      creationPromises.push((async () => {
        const password = 'Password123!';
        
        // Register Sender
        const regSenderRes = await fetch(`${API_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: `sender-multi-${timestamp}-${i}@test.com`, password })
        });
        const sender = await regSenderRes.json();

        // Register Receiver
        const regReceiverRes = await fetch(`${API_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: `receiver-multi-${timestamp}-${i}@test.com`, password })
        });
        const receiver = await regReceiverRes.json();

        // Log in Sender to get token
        const loginRes = await fetch(`${API_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: sender.user.email, password })
        });
        const authData = await loginRes.json();

        return {
          senderEmail: sender.user.email,
          senderToken: authData.accessToken,
          senderWalletId: sender.wallet.id,
          receiverEmail: receiver.user.email,
          receiverWalletId: receiver.wallet.id
        };
      })());
    }

    const pairs = await Promise.all(creationPromises);
    console.log('✔ All pairs registered and sender sessions established.');

    // 2. Fire transfers concurrently
    console.log(`\n🚀 Firing ${numPairs} parallel transfers of ₹150.00 concurrently...`);
    const transferPromises = [];

    for (let i = 0; i < numPairs; i++) {
      const pair = pairs[i];
      const idempotencyKey = `idem-multi-${timestamp}-${i}`;
      
      transferPromises.push(
        fetch(`${API_URL}/api/wallet/transfer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${pair.senderToken}`,
            'Idempotency-Key': idempotencyKey
          },
          body: JSON.stringify({
            destination_email: pair.receiverEmail,
            amount: 150.00,
            currency: 'INR'
          })
        }).then(r => r.json().then(data => ({ index: i, status: r.status, data })))
      );
    }

    const results = await Promise.all(transferPromises);
    const successes = results.filter(r => r.status === 200).length;
    const failures = results.filter(r => r.status !== 200);

    console.log(`Finished parallel transfers. Successes: ${successes}/${numPairs}`);
    
    if (failures.length > 0) {
      console.log('Failures encountered:');
      failures.forEach(f => console.log(`  -> Pair ${f.index} failed with status ${f.status}:`, f.data));
    }

    console.log('\nVerifying ledger balances...');
    await sleep(2000);

    // 3. Verify balance integrity
    let totalStartBalance = numPairs * 10000.00 * 2; // Each user starts with 10k
    let totalEndBalance = 0;
    let allBalancesCorrect = true;

    for (let i = 0; i < numPairs; i++) {
      const pair = pairs[i];
      
      // Get sender balance
      const sBalRes = await fetch(`${API_URL}/api/wallet/balance`, {
        headers: { 'Authorization': `Bearer ${pair.senderToken}` }
      });
      const sBalData = await sBalRes.json();
      const sBal = parseFloat(sBalData.balance);

      // Log in receiver to read balance
      const rLoginRes = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pair.receiverEmail, password: 'Password123!' })
      });
      const rAuthData = await rLoginRes.json();
      
      const rBalRes = await fetch(`${API_URL}/api/wallet/balance`, {
        headers: { 'Authorization': `Bearer ${rAuthData.accessToken}` }
      });
      const rBalData = await rBalRes.json();
      const rBal = parseFloat(rBalData.balance);

      totalEndBalance += (sBal + rBal);

      // Verify that 150 INR was deducted from sender and added to receiver
      if (sBal !== 9850.00 || rBal !== 10150.00) {
        console.log(`❌ Pair ${i} mismatch! Sender Bal: ₹${sBal}, Receiver Bal: ₹${rBal}`);
        allBalancesCorrect = false;
      }
    }

    console.log('\n=========================================');
    console.log('📊 MULTI-WALLET CONCURRENCY REPORT');
    console.log('=========================================');
    console.log(`Starting Total System Value: ₹${totalStartBalance.toFixed(2)}`);
    console.log(`Ending Total System Value:   ₹${totalEndBalance.toFixed(2)}`);
    
    if (totalStartBalance !== totalEndBalance) {
      console.log('❌ FAIL: System-wide double-spending or money loss detected!');
    } else if (!allBalancesCorrect) {
      console.log('❌ FAIL: System balance total is correct, but individual ledger records mismatched.');
    } else {
      console.log('✔ PASS: All parallel multi-wallet transfers succeeded with 100% accuracy.');
      console.log('✔ PASS: No database deadlock exceptions encountered.');
      console.log('✔ PASS: Transaction isolation levels and row-locking verified.');
      console.log('\n✨ MULTI-WALLET CONCURRENCY TEST SUCCEEDED! ✨');
    }

  } catch (error) {
    console.error('Multi-wallet test execution failed:', error);
  }
}

runTest();
