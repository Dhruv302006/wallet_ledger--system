import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { kafka, createTopicIfNotExists } from '../services/kafka.service.js';
import redis from '../config/redis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auditLogPath = path.join(__dirname, '../../logs/audit.log');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Instantiate distinct consumer groups to demonstrate Kafka's parallel fan-out capabilities.
// If one consumer group is down or lags, others are completely unaffected.
const notificationConsumer = kafka.consumer({ groupId: 'notification-service-group' });
const analyticsConsumer = kafka.consumer({ groupId: 'analytics-service-group' });
const auditConsumer = kafka.consumer({ groupId: 'audit-service-group' });

/**
 * Initializes and starts all three independent Kafka consumer workers in parallel:
 * Notification consumer, Analytics consumer, and Audit consumer.
 * Ensures the topic is created before subscribing.
 */
export const startWorkers = async () => {
  console.log('Starting asynchronous Kafka consumer workers...');
  
  // Ensure topic exists to prevent UNKNOWN_TOPIC_OR_PARTITION errors
  await createTopicIfNotExists('transaction-events');

  // Connect and start Notification Service
  try {
    await notificationConsumer.connect();
    await notificationConsumer.subscribe({ topic: 'transaction-events', fromBeginning: false });
    await notificationConsumer.run({
      eachMessage: async ({ message }) => {
        const event = JSON.parse(message.value.toString());
        const amountStr = `${event.currency} ${parseFloat(event.amount).toFixed(2)}`;
        
        console.log(`\x1b[36m[Notification Worker]\x1b[0m Alert for transaction ${event.transaction_id}:`);
        if (event.event_type === 'TransactionCompleted') {
          console.log(`  -> Sent DEBIT alert to user with Wallet: ${event.source_wallet_id}`);
          console.log(`  -> Sent CREDIT alert to user with Wallet: ${event.destination_wallet_id}`);
        } else if (event.event_type === 'DepositCompleted') {
          console.log(`  -> Sent CREDIT alert to user with Wallet: ${event.destination_wallet_id}`);
        }
      }
    });
    console.log('✔ Notification Worker initialized.');
  } catch (err) {
    console.error('✖ Error starting Notification Worker:', err);
  }

  // Connect and start Analytics Service
  try {
    await analyticsConsumer.connect();
    await analyticsConsumer.subscribe({ topic: 'transaction-events', fromBeginning: false });
    await analyticsConsumer.run({
      eachMessage: async ({ message }) => {
        const event = JSON.parse(message.value.toString());
        const amount = parseFloat(event.amount);
        const today = new Date().toISOString().split('T')[0];

        // Increment analytics counters in Redis
        await redis.pipeline()
          .incr('analytics:total_transactions')
          .incrbyfloat('analytics:total_volume', amount)
          .hincrby('analytics:daily_volume', today, Math.round(amount))
          .exec();

        console.log(`\x1b[32m[Analytics Worker]\x1b[0m Metrics updated in Redis (+${amount} INR volume).`);
      }
    });
    console.log('✔ Analytics Worker initialized.');
  } catch (err) {
    console.error('✖ Error starting Analytics Worker:', err);
  }

  // Connect and start Audit Service
  try {
    await auditConsumer.connect();
    await auditConsumer.subscribe({ topic: 'transaction-events', fromBeginning: false });
    await auditConsumer.run({
      eachMessage: async ({ message }) => {
        const event = JSON.parse(message.value.toString());
        const logEntry = {
          timestamp: new Date().toISOString(),
          ...event
        };
        fs.appendFileSync(auditLogPath, JSON.stringify(logEntry) + '\n');
        console.log(`\x1b[33m[Audit Worker]\x1b[0m Appended transaction ${event.transaction_id} to audit log file.`);
      }
    });
    console.log('✔ Audit Worker initialized.');
  } catch (err) {
    console.error('✖ Error starting Audit Worker:', err);
  }
};

// Start workers directly if run via CLI
const runAsScript = process.argv[1] === fileURLToPath(import.meta.url);
if (runAsScript) {
  startWorkers();
}
/**
 * Disconnects all three active Kafka consumer groups cleanly during server shutdown.
 */
export const stopWorkers = async () => {
  console.log('Stopping Kafka consumer workers...');
  try {
    await Promise.all([
      notificationConsumer.disconnect(),
      analyticsConsumer.disconnect(),
      auditConsumer.disconnect()
    ]);
    console.log('All Kafka workers stopped.');
  } catch (err) {
    console.error('Error stopping workers:', err);
  }
};
