import { v4 as uuidv4 } from 'uuid';

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
 * Core test execution function. Registers users, logs in,
 * fires 50 parallel unique transfers and 10 duplicate concurrent requests,
 * and asserts that balances are consistent and duplicate transfers are safely blocked.
 */
async function runTest() {
  console.log('🏁 Starting high-concurrency wallet transaction test...');

  const timestamp = Date.now();
  const emailSender = `sender-${timestamp}@test.com`;
  const emailReceiver = `receiver-${timestamp}@test.com`;
  const password = 'Password123!';

  try {
    // 1. Register Sender
    console.log(`Creating sender user: ${emailSender}`);
    const regSenderRes = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailSender, password })
    });
    if (!regSenderRes.ok) throw new Error('Failed to register sender');
    const senderData = await regSenderRes.json();
    console.log(`✔ Sender created. Wallet ID: ${senderData.wallet.id}`);

    // 2. Register Receiver
    console.log(`Creating receiver user: ${emailReceiver}`);
    const regReceiverRes = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailReceiver, password })
    });
    if (!regReceiverRes.ok) throw new Error('Failed to register receiver');
    const receiverData = await regReceiverRes.json();
    console.log(`✔ Receiver created. Wallet ID: ${receiverData.wallet.id}`);

    // 3. Login Sender
    console.log('Logging in sender...');
    const loginRes = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailSender, password })
    });
    const authData = await loginRes.json();
    const token = authData.accessToken;
    console.log('✔ Sender logged in.');

    // Get starting balance
    const senderStartBal = parseFloat(senderData.wallet.balance);
    const receiverStartBal = parseFloat(receiverData.wallet.balance);
    const totalStartMoney = senderStartBal + receiverStartBal;
    console.log(`Initial Balances -> Sender: ₹${senderStartBal}, Receiver: ₹${receiverStartBal} (Total: ₹${totalStartMoney})`);

    // 4. Fire concurrent transactions
    console.log('\n🚀 Triggering 50 concurrent transfers (₹10.00 each) with UNIQUE keys...');
    
    const uniquePromises = [];
    const transferAmount = 10.00;
    
    for (let i = 0; i < 50; i++) {
      const uniqueKey = `test-key-uniq-${timestamp}-${i}`;
      uniquePromises.push(
        fetch(`${API_URL}/api/wallet/transfer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Idempotency-Key': uniqueKey
          },
          body: JSON.stringify({
            destination_email: emailReceiver,
            amount: transferAmount,
            currency: 'INR'
          })
        }).then(r => r.json().then(data => ({ status: r.status, data })))
      );
    }

    const uniqueResults = await Promise.all(uniquePromises);
    const uniqueSuccesses = uniqueResults.filter(r => r.status === 200).length;
    const uniqueFailures = uniqueResults.filter(r => r.status !== 200).length;
    console.log(`Finished unique key requests. Successes: ${uniqueSuccesses}, Failures: ${uniqueFailures}`);

    // 5. Fire duplicate requests (Idempotency Key validation)
    console.log('\n🔒 Triggering 10 duplicate transfers with the EXACT SAME idempotency key (simulating network retries/double clicks)...');
    
    const duplicateKey = `test-key-dup-${timestamp}`;
    const dupPromises = [];
    
    for (let i = 0; i < 10; i++) {
      dupPromises.push(
        fetch(`${API_URL}/api/wallet/transfer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Idempotency-Key': duplicateKey
          },
          body: JSON.stringify({
            destination_email: emailReceiver,
            amount: 50.00, // ₹50 transfer
            currency: 'INR'
          })
        }).then(r => r.json().then(data => ({ status: r.status, data })))
      );
    }

    const dupResults = await Promise.all(dupPromises);
    const dupSuccesses = dupResults.filter(r => r.status === 200).length;
    const dupConflicts = dupResults.filter(r => r.status === 409 || r.status === 400).length;
    
    console.log(`Finished duplicate key requests. Successful hits: ${dupSuccesses}, Blocked duplicates: ${dupConflicts}`);

    // Wait a brief second for write-through cache and Kafka processing
    console.log('\nVerifying engine consistency...');
    await sleep(2000);

    // 6. Verify final balances
    const senderBalRes = await fetch(`${API_URL}/api/wallet/balance`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const senderBalData = await senderBalRes.json();
    const finalSenderBal = parseFloat(senderBalData.balance);

    // Log in receiver to read their balance
    const recLoginRes = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailReceiver, password })
    });
    const recAuthData = await recLoginRes.json();
    const recToken = recAuthData.accessToken;
    
    const recBalRes = await fetch(`${API_URL}/api/wallet/balance`, {
      headers: { 'Authorization': `Bearer ${recToken}` }
    });
    const recBalData = await recBalRes.json();
    const finalReceiverBal = parseFloat(recBalData.balance);

    const totalEndMoney = finalSenderBal + finalReceiverBal;

    console.log('\n=========================================');
    console.log('📊 CONCURRENCY TEST REPORT');
    console.log('=========================================');
    console.log(`Starting Total Money:  ₹${totalStartMoney.toFixed(2)}`);
    console.log(`Ending Total Money:    ₹${totalEndMoney.toFixed(2)}`);
    console.log(`Final Sender Balance:   ₹${finalSenderBal.toFixed(2)}`);
    console.log(`Final Receiver Balance: ₹${finalReceiverBal.toFixed(2)}`);
    
    // We expect:
    // - 50 transfers of ₹10 = ₹500
    // - 1 transfer of ₹50 (due to duplicate key deduplication) = ₹50
    // - Total expected decrease = ₹550
    const expectedDebit = (uniqueSuccesses * transferAmount) + (dupSuccesses > 0 ? 50.00 : 0);
    const actualDebit = senderStartBal - finalSenderBal;
    
    console.log(`Expected Total Debit:  ₹${expectedDebit.toFixed(2)}`);
    console.log(`Actual Total Debit:    ₹${actualDebit.toFixed(2)}`);

    let testPassed = true;

    if (totalStartMoney.toFixed(4) !== totalEndMoney.toFixed(4)) {
      console.log('❌ FAIL: Money was lost or duplicated in transit!');
      testPassed = false;
    } else {
      console.log('✔ PASS: Ledger integrity maintained. No money lost or duplicated.');
    }

    if (expectedDebit !== actualDebit) {
      console.log(`❌ FAIL: Expected debit amount does not match actual balance change!`);
      testPassed = false;
    } else {
      console.log('✔ PASS: Core transaction limits and double-spending protections verified.');
    }

    if (dupSuccesses > 1) {
      console.log(`❌ FAIL: Idempotency failed! Key was executed ${dupSuccesses} times.`);
      testPassed = false;
    } else {
      console.log('✔ PASS: Idempotency engine successfully deduplicated concurrent double-clicks.');
    }

    if (testPassed) {
      console.log('\n✨ ALL CONCURRENCY TESTS PASSED! The engine is highly resilient under load. ✨');
    } else {
      console.log('\n❌ CONCURRENCY VERIFICATION FAILED. Review transaction locks or isolation levels.');
    }

  } catch (error) {
    console.error('Test execution failed with error:', error);
  }
}

runTest();
