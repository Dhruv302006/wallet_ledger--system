let userToken = localStorage.getItem('token') || null;
let activeWalletId = null;
let lastLogCount = 0;

// On Load
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  
  // Tab Switchers
  document.getElementById('tab-login').addEventListener('click', () => switchTab('login'));
  document.getElementById('tab-register').addEventListener('click', () => switchTab('register'));

  // Auth Forms
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('register-form').addEventListener('submit', handleRegister);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Transaction Forms
  document.getElementById('transfer-form').addEventListener('submit', handleTransfer);
  document.getElementById('regen-key-btn').addEventListener('click', generateIdempotencyKey);
  document.getElementById('trigger-deposit-btn').addEventListener('click', triggerQuickDeposit);

  // Generate initial key
  generateIdempotencyKey();
});

function initApp() {
  if (userToken) {
    showDashboard();
  } else {
    showAuth();
  }
}

function switchTab(type) {
  const loginTab = document.getElementById('tab-login');
  const registerTab = document.getElementById('tab-register');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  if (type === 'login') {
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
  } else {
    loginTab.classList.remove('active');
    registerTab.classList.add('active');
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
  }
}

function generateIdempotencyKey() {
  const key = 'idem-' + Math.random().toString(36).substring(2, 15) + '-' + Math.random().toString(36).substring(2, 15);
  document.getElementById('idempotency-key').value = key;
}

// Show/Hide Dashboard Screens
function showDashboard() {
  document.getElementById('auth-section').classList.add('hidden');
  document.getElementById('dashboard-section').classList.remove('hidden');
  document.getElementById('user-profile').classList.remove('hidden');
  
  // Set email
  const email = localStorage.getItem('email');
  document.getElementById('user-email-display').textContent = email;

  // Poll metrics and refresh dashboard
  refreshWalletData();
  startMetricsPolling();
}

function showAuth() {
  document.getElementById('auth-section').classList.remove('hidden');
  document.getElementById('dashboard-section').classList.add('hidden');
  document.getElementById('user-profile').classList.add('hidden');
  stopMetricsPolling();
}

// Auth Handlers
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  
  showAlert('auth-message', null); // clear
  
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error || 'Login failed');
    
    userToken = data.accessToken;
    localStorage.setItem('token', userToken);
    localStorage.setItem('email', data.user.email);
    
    showDashboard();
  } catch (err) {
    showAlert('auth-message', err.message, 'danger');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  
  showAlert('auth-message', null);
  
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    
    showAlert('auth-message', 'Registration successful! Directing to sign in.', 'success');
    setTimeout(() => {
      switchTab('login');
      document.getElementById('login-email').value = email;
    }, 1500);
  } catch (err) {
    showAlert('auth-message', err.message, 'danger');
  }
}

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}
  
  userToken = null;
  localStorage.removeItem('token');
  localStorage.removeItem('email');
  showAuth();
}

// Fetch Wallet Data
async function refreshWalletData() {
  if (!userToken) return;

  try {
    // 1. Get Balance
    const balanceRes = await fetch('/api/wallet/balance', {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    if (balanceRes.status === 401) return handleLogout();
    const balanceData = await balanceRes.json();
    
    if (balanceRes.ok) {
      document.getElementById('balance-amount').textContent = parseFloat(balanceData.balance).toFixed(2);
      document.getElementById('wallet-id-display').textContent = balanceData.wallet_id;
      activeWalletId = balanceData.wallet_id;
    }

    // 2. Get Ledger History
    const historyRes = await fetch('/api/wallet/history', {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    const historyData = await historyRes.json();
    
    if (historyRes.ok) {
      renderHistory(historyData.history);
    }
  } catch (err) {
    console.error('Error fetching wallet data:', err);
  }
}

function renderHistory(history) {
  const rowsContainer = document.getElementById('history-rows');
  if (!history || history.length === 0) {
    rowsContainer.innerHTML = `<tr><td colspan="5" class="empty-table">No transaction history.</td></tr>`;
    return;
  }

  rowsContainer.innerHTML = history.map(item => {
    const isCredit = item.entry_type === 'credit';
    const amountClass = isCredit ? 'tx-type-credit' : 'tx-type-debit';
    const amountPrefix = isCredit ? '+' : '-';
    const dateStr = new Date(item.created_at).toLocaleString();
    
    return `
      <tr>
        <td title="${item.transaction_id}">${item.transaction_id.substring(0, 8)}...</td>
        <td class="${amountClass}">${item.entry_type.toUpperCase()}</td>
        <td class="${amountClass}">${amountPrefix}₹${parseFloat(item.amount).toFixed(2)}</td>
        <td>₹${parseFloat(item.balance_after).toFixed(2)}</td>
        <td>${dateStr}</td>
      </tr>
    `;
  }).join('');
}

// Handle Transactions
async function handleTransfer(e) {
  e.preventDefault();
  const destEmail = document.getElementById('transfer-email').value;
  const amount = document.getElementById('transfer-amount').value;
  const idempotencyKey = document.getElementById('idempotency-key').value;

  showAlert('transfer-message', null);
  document.getElementById('transfer-submit-btn').disabled = true;

  try {
    const res = await fetch('/api/wallet/transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        destination_email: destEmail,
        amount: parseFloat(amount),
        currency: 'INR'
      })
    });
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error || 'Transfer failed');

    showAlert('transfer-message', `Successfully transferred ₹${parseFloat(amount).toFixed(2)}!`, 'success');
    document.getElementById('transfer-amount').value = '';
    
    // Invalidate and generate next key
    generateIdempotencyKey();
    refreshWalletData();
  } catch (err) {
    showAlert('transfer-message', err.message, 'danger');
  } finally {
    document.getElementById('transfer-submit-btn').disabled = false;
  }
}

async function triggerQuickDeposit() {
  const idempotencyKey = 'idem-dep-' + Math.random().toString(36).substring(2, 10);
  try {
    const res = await fetch('/api/wallet/deposit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        amount: 1000.00,
        currency: 'INR'
      })
    });
    
    if (res.ok) {
      refreshWalletData();
    }
  } catch (err) {
    console.error('Quick deposit failed', err);
  }
}

// Polling Metrics
let metricsInterval = null;

function startMetricsPolling() {
  fetchMetrics();
  metricsInterval = setInterval(fetchMetrics, 3000);
}

function stopMetricsPolling() {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }
}

async function fetchMetrics() {
  try {
    const res = await fetch('/api/analytics/metrics');
    const data = await res.json();
    
    if (res.ok) {
      document.getElementById('metrics-volume').textContent = `₹${parseFloat(data.total_volume).toFixed(2)}`;
      document.getElementById('metrics-count').textContent = data.total_transactions;
      document.getElementById('metrics-db').textContent = `${data.db_connections.total_connections} / 50`;
      
      // Update logs simulator (pulling new events from memory/simulated feed)
      if (data.total_transactions !== lastLogCount) {
        logEventToPanel(data);
        lastLogCount = data.total_transactions;
        refreshWalletData();
      }
    }
  } catch (err) {
    console.error('Error fetching metrics', err);
  }
}

function logEventToPanel(metrics) {
  const logFeed = document.getElementById('live-logs');
  const now = new Date().toLocaleTimeString();
  
  const logMsg = document.createElement('div');
  logMsg.className = 'log-line audit';
  logMsg.textContent = `[${now}] Kafka Event Consumed: total tx count increased to ${metrics.total_transactions}. Volume: ₹${metrics.total_volume.toFixed(2)}`;
  
  logFeed.appendChild(logMsg);
  logFeed.scrollTop = logFeed.scrollHeight;
}

// Helper Alert Display
function showAlert(id, text, type) {
  const alertEl = document.getElementById(id);
  if (!text) {
    alertEl.classList.add('hidden');
    alertEl.className = 'alert';
    return;
  }
  
  alertEl.textContent = text;
  alertEl.className = `alert alert-${type}`;
  alertEl.classList.remove('hidden');
}
