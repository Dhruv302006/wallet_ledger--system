import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PASSWORD_HASH = '$2a$10$VvSX/.dfZ44qLCnoTiLtsecGwXZtwrwNX9Ja/7Naxfda6196ZRr22'; // Hashed 'Password123'

// 1. Define personas and details
const personas = {
  // Students
  aarav: {
    name: 'Aarav Mehta',
    email: 'aarav.student@domain.com',
    role: 'user',
    signupOffset: 30, // Days after start date
    persona: 'student',
    targetMin: 500,
    targetMax: 3000,
    allowanceDay: 0, // Sunday (0 = Sunday, 1 = Monday...)
    allowanceAmount: 5000,
  },
  rohan: {
    name: 'Rohan Sharma',
    email: 'rohan.student@domain.com',
    role: 'user',
    signupOffset: 32,
    persona: 'student',
    targetMin: 500,
    targetMax: 3000,
    allowanceDay: 0,
    allowanceAmount: 4000,
  },
  // Salaried Employee
  priya: {
    name: 'Priya Patel',
    email: 'priya.salaried@domain.com',
    role: 'user',
    signupOffset: 5,
    persona: 'salaried',
    salaryDay: 1, // 1st of month
    salaryAmount: 85000,
    rentDay: 3,
    rentAmount: 25000,
    utilityDay: 5,
    subscriptionDay: 10,
  },
  // Landlord to receive Priya's rent
  amit: {
    name: 'Amit Kumar',
    email: 'amit.landlord@domain.com',
    role: 'user',
    signupOffset: 0,
    persona: 'landlord',
  },
  // Freelancer
  vikram: {
    name: 'Vikram Singh',
    email: 'vikram.free@domain.com',
    role: 'user',
    signupOffset: 45,
    persona: 'freelancer',
    coWorkingDay: 12,
    toolsDay: 15,
  },
  // Business Owner
  aditya: {
    name: 'Aditya Gupta',
    email: 'aditya.biz@domain.com',
    role: 'user',
    signupOffset: 15,
    persona: 'business_owner',
    rentDay: 2,
    staffDay: 7,
    staffAmount: 18000,
  },
  supplier: {
    name: 'Supplier Co',
    email: 'supplier@domain.com',
    role: 'user',
    signupOffset: 0,
    persona: 'merchant',
  },
  staff: {
    name: 'Ravi Verma (Staff)',
    email: 'staff.amit@domain.com',
    role: 'user',
    signupOffset: 0,
    persona: 'merchant',
  },
  // Frequent Traveler
  ananya: {
    name: 'Ananya Rao',
    email: 'ananya.travel@domain.com',
    role: 'user',
    signupOffset: 20,
    persona: 'traveler',
    salaryDay: 1,
    salaryAmount: 120000,
  }
};

// 2. Define Merchants (their wallets will collect debits from users)
const merchants = {
  zomato: { name: 'Zomato Merchant', email: 'merchant.zomato@domain.com', category: 'Food & Dining', city: 'Mumbai' },
  uber: { name: 'Uber Merchant', email: 'merchant.uber@domain.com', category: 'Transport', city: 'Bangalore' },
  amazon: { name: 'Amazon India', email: 'merchant.amazon@domain.com', category: 'Shopping', city: 'Delhi' },
  netflix: { name: 'Netflix India', email: 'merchant.netflix@domain.com', category: 'Entertainment', city: 'Mumbai' },
  bigbasket: { name: 'BigBasket Groceries', email: 'merchant.bigbasket@domain.com', category: 'Groceries', city: 'Bangalore' },
  wework: { name: 'WeWork India', email: 'merchant.wework@domain.com', category: 'Business Services', city: 'Mumbai' },
  starbucks: { name: 'Starbucks Coffee', email: 'merchant.starbucks@domain.com', category: 'Food & Dining', city: 'Delhi' },
  airbnb: { name: 'Airbnb Stay', email: 'merchant.airbnb@domain.com', category: 'Travel & Lodging', city: 'Goa' },
  makemytrip: { name: 'MakeMyTrip Hotels', email: 'merchant.makemytrip@domain.com', category: 'Travel & Lodging', city: 'Gurugram' },
  adani: { name: 'Adani Electricity', email: 'merchant.utility.adani@domain.com', category: 'Utilities', city: 'Mumbai' },
  airtel: { name: 'Airtel Telecom', email: 'merchant.telecom.airtel@domain.com', category: 'Utilities', city: 'Delhi' },
};

// Cities list for random traveler purchases
const travelCities = ['Mumbai', 'Delhi', 'Bangalore', 'Goa', 'Jaipur', 'Kochi', 'Hyderabad', 'Pune'];

// Device types for analytics
const devices = ['iOS', 'Android', 'Web'];

// Helper to get random number in range
const randomRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Generate full mock dataset
async function generateDataset() {
  console.log('🚀 Initiating dataset generation sequence...');
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 365); // 365 days ago
  const endDate = new Date();

  // In-memory data tables
  const usersList = [];
  const walletsList = [];
  const transactionsList = [];
  const ledgerEntriesList = [];
  const metadataList = [];

  // Wallet tracking helper
  const walletBalances = {}; // walletId -> current balance (number)

  // Map of email -> walletId
  const emailToWalletId = {};

  // Setup Merchants first (day 0)
  for (const [key, merch] of Object.entries(merchants)) {
    const userId = uuidv4();
    const walletId = uuidv4();
    const createdAt = new Date(startDate).toISOString();

    usersList.push({
      id: userId,
      email: merch.email,
      password_hash: PASSWORD_HASH,
      role: 'merchant',
      created_at: createdAt,
      updated_at: createdAt
    });

    walletsList.push({
      id: walletId,
      user_id: userId,
      currency: 'INR',
      balance: 0.0000,
      status: 'active',
      created_at: createdAt,
      updated_at: createdAt
    });

    walletBalances[walletId] = 0.0000;
    emailToWalletId[merch.email] = walletId;
  }

  // Setup Amit, Supplier Co, Staff as active from start (day 0)
  const activeIds = ['amit', 'supplier', 'staff'];
  for (const key of activeIds) {
    const info = personas[key];
    const userId = uuidv4();
    const walletId = uuidv4();
    const createdAt = new Date(startDate).toISOString();

    usersList.push({
      id: userId,
      email: info.email,
      password_hash: PASSWORD_HASH,
      role: info.role,
      created_at: createdAt,
      updated_at: createdAt
    });

    // Start landlord/merchants with ₹0. Start other users with ₹10,000 signup
    const initialBalance = info.persona === 'merchant' || info.persona === 'landlord' ? 0.0000 : 10000.0000;

    walletsList.push({
      id: walletId,
      user_id: userId,
      currency: 'INR',
      balance: initialBalance,
      status: 'active',
      created_at: createdAt,
      updated_at: createdAt
    });

    walletBalances[walletId] = initialBalance;
    emailToWalletId[info.email] = walletId;

    // Create signup ledger entries if starting with initial balance
    if (initialBalance > 0) {
      const txId = uuidv4();
      const idemKey = `signup-bonus-${userId}`;
      transactionsList.push({
        id: txId,
        idempotency_key: idemKey,
        source_wallet_id: null,
        destination_wallet_id: walletId,
        amount: initialBalance,
        currency: 'INR',
        status: 'completed',
        error_reason: null,
        created_at: createdAt,
        updated_at: createdAt
      });

      ledgerEntriesList.push({
        transaction_id: txId,
        wallet_id: walletId,
        entry_type: 'credit',
        amount: initialBalance,
        balance_after: initialBalance,
        created_at: createdAt
      });

      metadataList.push({
        transaction_id: txId,
        category: 'Reward',
        merchant_name: 'SignUp Bonus',
        payment_method: 'Internal Credit',
        city: 'Mumbai',
        device_type: 'Web',
        ip_address: '127.0.0.1',
        location_lat: 19.0760,
        location_lng: 72.8777
      });
    }
  }

  // Active user accounts tracking
  const activePersonas = {};

  // Loop day-by-day
  const currentDate = new Date(startDate);
  let daysSimulated = 0;

  while (currentDate <= endDate) {
    const formattedDate = currentDate.toISOString();
    const dateStr = currentDate.toDateString();
    const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday...
    const dateOfMonth = currentDate.getDate();

    // 1. Check if any personas sign up today
    for (const [key, info] of Object.entries(personas)) {
      if (activeIds.includes(key)) continue; // Already added

      const signupDate = new Date(startDate);
      signupDate.setDate(signupDate.getDate() + info.signupOffset);

      if (signupDate.toDateString() === dateStr) {
        // Register user today!
        const userId = uuidv4();
        const walletId = uuidv4();

        usersList.push({
          id: userId,
          email: info.email,
          password_hash: PASSWORD_HASH,
          role: info.role,
          created_at: formattedDate,
          updated_at: formattedDate
        });

        // Initialize wallet with default balance (₹10,000)
        const initialBalance = 10000.0000;
        walletsList.push({
          id: walletId,
          user_id: userId,
          currency: 'INR',
          balance: initialBalance,
          status: 'active',
          created_at: formattedDate,
          updated_at: formattedDate
        });

        walletBalances[walletId] = initialBalance;
        emailToWalletId[info.email] = walletId;

        // Signup Transaction & Ledger
        const txId = uuidv4();
        const idemKey = `signup-bonus-${userId}`;
        transactionsList.push({
          id: txId,
          idempotency_key: idemKey,
          source_wallet_id: null,
          destination_wallet_id: walletId,
          amount: initialBalance,
          currency: 'INR',
          status: 'completed',
          error_reason: null,
          created_at: formattedDate,
          updated_at: formattedDate
        });

        ledgerEntriesList.push({
          transaction_id: txId,
          wallet_id: walletId,
          entry_type: 'credit',
          amount: initialBalance,
          balance_after: initialBalance,
          created_at: formattedDate
        });

        metadataList.push({
          transaction_id: txId,
          category: 'Reward',
          merchant_name: 'SignUp Bonus',
          payment_method: 'Internal Credit',
          city: 'Mumbai',
          device_type: 'Web',
          ip_address: `192.168.1.${randomRange(10, 250)}`,
          location_lat: 19.0760,
          location_lng: 72.8777
        });

        activePersonas[key] = {
          walletId,
          info,
          travelState: { isTraveling: false, daysLeft: 0, city: 'Mumbai' }
        };

        console.log(`[Day ${daysSimulated}] Person signed up: ${info.name} (${info.email})`);
      }
    }

    // Helper: record a completed transfer
    const recordTransfer = (sourceId, destId, amount, category, merchant, metadataOverride = {}) => {
      const srcBal = walletBalances[sourceId];
      const destBal = walletBalances[destId];

      if (srcBal < amount) {
        // Log a failed transaction
        const txId = uuidv4();
        const idemKey = `tx-${uuidv4()}`;
        transactionsList.push({
          id: txId,
          idempotency_key: idemKey,
          source_wallet_id: sourceId,
          destination_wallet_id: destId,
          amount: amount,
          currency: 'INR',
          status: 'failed',
          error_reason: 'Insufficient balance',
          created_at: formattedDate,
          updated_at: formattedDate
        });
        return false;
      }

      // Valid transfer
      const txId = uuidv4();
      const idemKey = `tx-${uuidv4()}`;
      
      const newSrcBal = srcBal - amount;
      const newDestBal = destBal + amount;
      
      walletBalances[sourceId] = newSrcBal;
      walletBalances[destId] = newDestBal;

      transactionsList.push({
        id: txId,
        idempotency_key: idemKey,
        source_wallet_id: sourceId,
        destination_wallet_id: destId,
        amount: amount,
        currency: 'INR',
        status: 'completed',
        error_reason: null,
        created_at: formattedDate,
        updated_at: formattedDate
      });

      ledgerEntriesList.push({
        transaction_id: txId,
        wallet_id: sourceId,
        entry_type: 'debit',
        amount: amount,
        balance_after: newSrcBal,
        created_at: formattedDate
      });

      ledgerEntriesList.push({
        transaction_id: txId,
        wallet_id: destId,
        entry_type: 'credit',
        amount: amount,
        balance_after: newDestBal,
        created_at: formattedDate
      });

      metadataList.push({
        transaction_id: txId,
        category,
        merchant_name: merchant,
        payment_method: 'Wallet',
        city: metadataOverride.city || 'Mumbai',
        device_type: randomChoice(devices),
        ip_address: metadataOverride.ip || `192.168.1.${randomRange(10, 250)}`,
        location_lat: metadataOverride.lat || 19.0760,
        location_lng: metadataOverride.lng || 72.8777
      });

      // Simulates random cashback (5% probability)
      if (Math.random() < 0.05 && ['Food & Dining', 'Transport', 'Shopping'].includes(category)) {
        const cashbackAmount = parseFloat((amount * 0.05).toFixed(2));
        if (cashbackAmount >= 5) {
          recordDeposit(sourceId, cashbackAmount, 'Cashback', 'Wallet Promo', metadataOverride);
        }
      }

      return true;
    };

    // Helper: record a completed deposit (top-up / external income)
    const recordDeposit = (destId, amount, category, merchant, metadataOverride = {}) => {
      const destBal = walletBalances[destId];
      const txId = uuidv4();
      const idemKey = `dep-${uuidv4()}`;

      const newDestBal = destBal + amount;
      walletBalances[destId] = newDestBal;

      transactionsList.push({
        id: txId,
        idempotency_key: idemKey,
        source_wallet_id: null,
        destination_wallet_id: destId,
        amount: amount,
        currency: 'INR',
        status: 'completed',
        error_reason: null,
        created_at: formattedDate,
        updated_at: formattedDate
      });

      ledgerEntriesList.push({
        transaction_id: txId,
        wallet_id: destId,
        entry_type: 'credit',
        amount: amount,
        balance_after: newDestBal,
        created_at: formattedDate
      });

      metadataList.push({
        transaction_id: txId,
        category,
        merchant_name: merchant,
        payment_method: randomChoice(['UPI', 'Debit Card', 'Credit Card']),
        city: metadataOverride.city || 'Mumbai',
        device_type: randomChoice(devices),
        ip_address: metadataOverride.ip || `192.168.1.${randomRange(10, 250)}`,
        location_lat: metadataOverride.lat || 19.0760,
        location_lng: metadataOverride.lng || 72.8777
      });
    };

    // 2. Process transactions for this day
    for (const [key, state] of Object.entries(activePersonas)) {
      const walletId = state.walletId;
      const info = state.info;

      // --- Persona-Specific Rules ---

      // A. AARAV & ROHAN (Students)
      if (info.persona === 'student') {
        // Sunday Parent Allowance Top-up
        if (dayOfWeek === info.allowanceDay) {
          recordDeposit(walletId, info.allowanceAmount, 'Allowance', 'Parent Support');
        }

        // Daily Transaction Roll
        if (Math.random() < 0.45) {
          const roll = Math.random();
          if (roll < 0.35) {
            // Zomato food delivery
            recordTransfer(walletId, emailToWalletId[merchants.zomato.email], randomRange(150, 450), 'Food & Dining', 'Zomato');
          } else if (roll < 0.55) {
            // Uber ride
            recordTransfer(walletId, emailToWalletId[merchants.uber.email], randomRange(100, 320), 'Transport', 'Uber');
          } else if (roll < 0.70) {
            // Amazon Shopping
            recordTransfer(walletId, emailToWalletId[merchants.amazon.email], randomRange(250, 1100), 'Shopping', 'Amazon');
          } else if (roll < 0.90) {
            // Split bills with Rohan/Aarav
            const friendKey = key === 'aarav' ? 'rohan' : 'aarav';
            const friendState = activePersonas[friendKey];
            if (friendState) {
              recordTransfer(walletId, friendState.walletId, randomRange(50, 250), 'P2P Transfer', friendState.info.name);
            }
          } else {
            // Monthly mobile recharge (Utilities)
            if (dateOfMonth === 10) {
              recordTransfer(walletId, emailToWalletId[merchants.airtel.email], 299, 'Utilities', 'Airtel Telecom');
            }
          }
        }
      }

      // B. PRIYA (Salaried Employee)
      if (info.persona === 'salaried') {
        // Salary credit on 1st
        if (dateOfMonth === info.salaryDay) {
          recordDeposit(walletId, info.salaryAmount, 'Salary', 'HDFC Corporate Payroll');
        }

        // Rent payment on 3rd
        if (dateOfMonth === info.rentDay) {
          recordTransfer(walletId, emailToWalletId[personas.amit.email], info.rentAmount, 'Rent', 'Amit Kumar (Landlord)');
        }

        // Utility payments on 5th
        if (dateOfMonth === info.utilityDay) {
          recordTransfer(walletId, emailToWalletId[merchants.adani.email], randomRange(2600, 4800), 'Utilities', 'Adani Power');
        }

        // Subscriptions on 10th
        if (dateOfMonth === info.subscriptionDay) {
          recordTransfer(walletId, emailToWalletId[merchants.netflix.email], 199, 'Subscription', 'Netflix India');
          recordTransfer(walletId, emailToWalletId[merchants.airtel.email], 699, 'Utilities', 'Airtel Broadband');
        }

        // Groceries every Saturday
        if (dayOfWeek === 6) {
          recordTransfer(walletId, emailToWalletId[merchants.bigbasket.email], randomRange(1800, 3500), 'Groceries', 'BigBasket');
        }

        // Daily Transaction Roll (35%)
        if (Math.random() < 0.35) {
          const roll = Math.random();
          if (roll < 0.40) {
            recordTransfer(walletId, emailToWalletId[merchants.zomato.email], randomRange(300, 750), 'Food & Dining', 'Zomato');
          } else if (roll < 0.70) {
            recordTransfer(walletId, emailToWalletId[merchants.uber.email], randomRange(180, 550), 'Transport', 'Uber');
          } else {
            recordTransfer(walletId, emailToWalletId[merchants.amazon.email], randomRange(800, 4200), 'Shopping', 'Amazon Shopping');
          }
        }
      }

      // C. VIKRAM (Freelancer)
      if (info.persona === 'freelancer') {
        // Random Freelance Income payouts (3-4 times a month)
        if (Math.random() < 0.12) {
          recordDeposit(walletId, randomRange(12000, 38000), 'Freelance Income', 'Upwork Global Escrow');
        }

        // Co-working rental on 12th
        if (dateOfMonth === info.coWorkingDay) {
          recordTransfer(walletId, emailToWalletId[merchants.wework.email], 8000, 'Business Services', 'WeWork Office Space');
        }

        // Tool subscriptions on 15th
        if (dateOfMonth === info.toolsDay) {
          recordTransfer(walletId, emailToWalletId[merchants.amazon.email], randomRange(1500, 3500), 'Subscription', 'AWS Services Cloud');
        }

        // Daily Transaction Roll (60%)
        if (Math.random() < 0.60) {
          const roll = Math.random();
          if (roll < 0.35) {
            // Cafe work coffee
            recordTransfer(walletId, emailToWalletId[merchants.starbucks.email], randomRange(180, 480), 'Food & Dining', 'Starbucks');
          } else if (roll < 0.65) {
            // Food delivery
            recordTransfer(walletId, emailToWalletId[merchants.zomato.email], randomRange(220, 600), 'Food & Dining', 'Zomato');
          } else if (roll < 0.85) {
            // Uber travel to clients
            recordTransfer(walletId, emailToWalletId[merchants.uber.email], randomRange(120, 450), 'Transport', 'Uber');
          } else {
            // Groceries
            recordTransfer(walletId, emailToWalletId[merchants.bigbasket.email], randomRange(800, 1800), 'Groceries', 'BigBasket');
          }
        }
      }

      // D. ADITYA (Business Owner)
      if (info.persona === 'business_owner') {
        // Daily client invoice payments (Credits)
        const numDailySales = randomRange(1, 3);
        for (let s = 0; s < numDailySales; s++) {
          if (Math.random() < 0.70) {
            recordDeposit(walletId, randomRange(4500, 18000), 'Business Revenue', 'Merchant POS Settlement');
          }
        }

        // Office Rent on 2nd
        if (dateOfMonth === info.rentDay) {
          recordTransfer(walletId, emailToWalletId[personas.amit.email], 35000, 'Rent', 'Commercial Office Rent');
        }

        // Employee wages on 7th
        if (dateOfMonth === info.staffDay) {
          recordTransfer(walletId, emailToWalletId[personas.staff.email], info.staffAmount, 'Business Expense', 'Staff Salary - Ravi Verma');
        }

        // Supplier payouts (3 times a month)
        if (dateOfMonth === 5 || dateOfMonth === 15 || dateOfMonth === 25) {
          recordTransfer(walletId, emailToWalletId[personas.supplier.email], randomRange(25000, 65000), 'Business Expense', 'Inventory Supplier Co');
        }

        // Personal / Utilities spending (Daily roll 45%)
        if (Math.random() < 0.45) {
          const roll = Math.random();
          if (roll < 0.30) {
            recordTransfer(walletId, emailToWalletId[merchants.starbucks.email], randomRange(200, 650), 'Food & Dining', 'Starbucks Business Meetup');
          } else if (roll < 0.60) {
            recordTransfer(walletId, emailToWalletId[merchants.uber.email], randomRange(350, 950), 'Transport', 'Uber Business Ride');
          } else {
            recordTransfer(walletId, emailToWalletId[merchants.amazon.email], randomRange(1200, 8500), 'Shopping', 'Amazon Office Supplies');
          }
        }
      }

      // E. ANANYA (Frequent Traveler)
      if (info.persona === 'traveler') {
        // Monthly remote salary
        if (dateOfMonth === info.salaryDay) {
          recordDeposit(walletId, info.salaryAmount, 'Salary', 'Remote Tech Corp');
        }

        // Traveler state machine
        const travel = state.travelState;
        if (travel.isTraveling) {
          travel.daysLeft--;
          if (travel.daysLeft <= 0) {
            travel.isTraveling = false;
            console.log(`[Day ${daysSimulated}] Ananya Rao finished traveling. Returned to Mumbai.`);
          } else {
            // Travel Spending
            const cityOverride = { city: travel.city };
            
            // Hotel/Resto/Transport (90% daily prob)
            if (Math.random() < 0.90) {
              const roll = Math.random();
              if (roll < 0.40) {
                // Hotel billing / Airbnb
                if (travel.daysLeft % 4 === 0) {
                  recordTransfer(walletId, emailToWalletId[merchants.airbnb.email], randomRange(4500, 9500), 'Travel & Lodging', 'Airbnb Lodging', cityOverride);
                }
              } else if (roll < 0.75) {
                // Local Dining
                recordTransfer(walletId, emailToWalletId[merchants.starbucks.email], randomRange(400, 1800), 'Food & Dining', 'Local Cafe/Restaurant', cityOverride);
              } else {
                // Local Transport
                recordTransfer(walletId, emailToWalletId[merchants.uber.email], randomRange(300, 1200), 'Transport', 'Uber Outstation', cityOverride);
              }
            }
          }
        } else {
          // Check if starting a new travel trip (15% probability if currently in Mumbai)
          if (Math.random() < 0.08) {
            travel.isTraveling = true;
            travel.daysLeft = randomRange(5, 14);
            travel.city = randomChoice(travelCities);
            console.log(`[Day ${daysSimulated}] Ananya Rao started a ${travel.daysLeft}-day trip to ${travel.city}!`);

            // Book Flight Tickets immediately
            recordTransfer(walletId, emailToWalletId[merchants.makemytrip.email], randomRange(4500, 15000), 'Travel & Lodging', 'MakeMyTrip Flight Booking', { city: 'Mumbai' });
          } else {
            // General home spending
            if (Math.random() < 0.25) {
              const roll = Math.random();
              if (roll < 0.50) {
                recordTransfer(walletId, emailToWalletId[merchants.zomato.email], randomRange(350, 700), 'Food & Dining', 'Zomato Home');
              } else if (roll < 0.80) {
                recordTransfer(walletId, emailToWalletId[merchants.uber.email], randomRange(200, 480), 'Transport', 'Uber Office');
              } else {
                recordTransfer(walletId, emailToWalletId[merchants.amazon.email], randomRange(600, 2500), 'Shopping', 'Amazon Lifestyle');
              }
            }
          }
        }
      }
    }

    daysSimulated++;
    currentDate.setDate(currentDate.getDate() + 1);
  }

  console.log(`✔ Finished simulation model over ${daysSimulated} days.`);

  // 3. Verify balance integrity
  console.log('🧐 Running balance integrity checks...');
  let totalCredits = 0;
  let totalDebits = 0;

  for (const [walletId, expectedBalance] of Object.entries(walletBalances)) {
    const creds = ledgerEntriesList.filter(le => le.wallet_id === walletId && le.entry_type === 'credit').reduce((sum, curr) => sum + curr.amount, 0);
    const debits = ledgerEntriesList.filter(le => le.wallet_id === walletId && le.entry_type === 'debit').reduce((sum, curr) => sum + curr.amount, 0);
    const computedBal = creds - debits;

    if (Math.abs(computedBal - expectedBalance) > 0.0001) {
      console.error(`Balance mismatch on wallet ${walletId}! Expected: ${expectedBalance}, Computed: ${computedBal}`);
    }
    totalCredits += creds;
    totalDebits += debits;
  }
  
  console.log(`Balance Integrity: Total Credits: ₹${totalCredits.toFixed(2)}, Total Debits: ₹${totalDebits.toFixed(2)}`);
  console.log(`Final records details:
    - Users: ${usersList.length}
    - Wallets: ${walletsList.length}
    - Transactions: ${transactionsList.length}
    - Ledger Entries: ${ledgerEntriesList.length}
    - Metadata Entries: ${metadataList.length}`);

  // Write files
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }

  // Helper to dump to CSV
  const dumpCSV = (filePath, headers, list) => {
    const csvContent = [
      headers.join(','),
      ...list.map(row => headers.map(header => {
        const val = row[header];
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(','))
    ].join('\n');
    fs.writeFileSync(filePath, csvContent, 'utf8');
    console.log(`✔ Dumped ${list.length} rows to ${path.basename(filePath)}`);
  };

  dumpCSV(path.join(dataDir, 'users.csv'), ['id', 'email', 'password_hash', 'role', 'created_at', 'updated_at'], usersList);
  dumpCSV(path.join(dataDir, 'wallets.csv'), ['id', 'user_id', 'currency', 'balance', 'status', 'created_at', 'updated_at'], walletsList.map(w => ({ ...w, balance: walletBalances[w.id].toFixed(4) })));
  dumpCSV(path.join(dataDir, 'transactions.csv'), ['id', 'idempotency_key', 'source_wallet_id', 'destination_wallet_id', 'amount', 'currency', 'status', 'error_reason', 'created_at', 'updated_at'], transactionsList);
  dumpCSV(path.join(dataDir, 'ledger_entries.csv'), ['transaction_id', 'wallet_id', 'entry_type', 'amount', 'balance_after', 'created_at'], ledgerEntriesList);
  dumpCSV(path.join(dataDir, 'transaction_metadata.csv'), ['transaction_id', 'category', 'merchant_name', 'payment_method', 'city', 'device_type', 'ip_address', 'location_lat', 'location_lng'], metadataList);

  // Try to write to DB
  console.log('🔌 Connecting to PostgreSQL to check database availability...');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    const client = await pool.connect();
    console.log('Connected to PostgreSQL database! Seeding tables...');

    await client.query('BEGIN');
    
    // Disable triggers/foreign keys checks momentarily or truncate in correct reference order
    console.log('Clearing existing table records...');
    await client.query('TRUNCATE TABLE refresh_tokens, ledger_entries, transactions, wallets, users CASCADE');
    
    // Seed Users
    console.log('Seeding Users...');
    for (const u of usersList) {
      await client.query(
        'INSERT INTO users (id, email, password_hash, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [u.id, u.email, u.password_hash, u.role, u.created_at, u.updated_at]
      );
    }

    // Seed Wallets (use the updated balances)
    console.log('Seeding Wallets...');
    for (const w of walletsList) {
      const finalBal = walletBalances[w.id].toFixed(4);
      await client.query(
        'INSERT INTO wallets (id, user_id, currency, balance, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [w.id, w.user_id, w.currency, finalBal, w.status, w.created_at, w.updated_at]
      );
    }

    // Seed Transactions
    console.log('Seeding Transactions...');
    for (const t of transactionsList) {
      await client.query(
        'INSERT INTO transactions (id, idempotency_key, source_wallet_id, destination_wallet_id, amount, currency, status, error_reason, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [t.id, t.idempotency_key, t.source_wallet_id, t.destination_wallet_id, t.amount, t.currency, t.status, t.error_reason, t.created_at, t.updated_at]
      );
    }

    // Seed Ledger Entries
    console.log('Seeding Ledger Entries...');
    for (const l of ledgerEntriesList) {
      await client.query(
        'INSERT INTO ledger_entries (transaction_id, wallet_id, entry_type, amount, balance_after, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [l.transaction_id, l.wallet_id, l.entry_type, l.amount, l.balance_after, l.created_at]
      );
    }

    // Create Metadata table if not exists and seed it
    console.log('Setting up metadata enrichment table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS transaction_metadata (
        transaction_id UUID PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
        category VARCHAR(100) NOT NULL,
        merchant_name VARCHAR(100),
        payment_method VARCHAR(50),
        city VARCHAR(100),
        device_type VARCHAR(50),
        ip_address VARCHAR(45),
        location_lat NUMERIC(9, 6),
        location_lng NUMERIC(9, 6)
      )
    `);

    console.log('Seeding transaction analytics metadata...');
    for (const m of metadataList) {
      await client.query(
        'INSERT INTO transaction_metadata (transaction_id, category, merchant_name, payment_method, city, device_type, ip_address, location_lat, location_lng) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [m.transaction_id, m.category, m.merchant_name, m.payment_method, m.city, m.device_type, m.ip_address, m.location_lat, m.location_lng]
      );
    }

    await client.query('COMMIT');
    console.log('🎉 Seeding successfully completed! PostgreSQL is fully populated.');
    client.release();
  } catch (dbErr) {
    console.error('⚠️ Database connection or execution failed:', dbErr.message);
    console.log('This is expected if Docker Desktop / PostgreSQL is currently closed.');
    console.log('💡 Note: All generated data has been safely saved as CSV files under the "data/" directory.');
  } finally {
    await pool.end();
  }
}

generateDataset();
