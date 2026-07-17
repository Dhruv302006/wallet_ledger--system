import { Kafka, Partitioners } from 'kafkajs';
import dotenv from 'dotenv';

dotenv.config();

const kafkaBrokers = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'];

const kafka = new Kafka({
  clientId: 'wallet-system',
  brokers: kafkaBrokers,
  retry: {
    initialRetryTime: 300,
    retries: 5
  }
});

const producer = kafka.producer({
  createPartitioner: Partitioners.LegacyPartitioner
});

let isConnected = false;

/**
 * Uses the Kafka Admin client to verify if a topic exists.
 * If the topic is missing, it creates the topic programmatically to prevent consumer subscribe crashes.
 * @param {string} topicName 
 */
export const createTopicIfNotExists = async (topicName) => {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const topics = await admin.listTopics();
    if (!topics.includes(topicName)) {
      console.log(`Topic "${topicName}" does not exist. Creating...`);
      await admin.createTopics({
        topics: [{
          topic: topicName,
          numPartitions: 1,
          replicationFactor: 1
        }]
      });
      console.log(`Topic "${topicName}" created successfully.`);
    }
  } catch (error) {
    console.error(`Error checking/creating topic "${topicName}":`, error);
  } finally {
    try {
      await admin.disconnect();
    } catch (e) {}
  }
};

/**
 * Establishes a connection to the Kafka broker for the Producer client.
 * Caches the connection state to avoid duplicate connection handshakes.
 */
export const connectProducer = async () => {
  if (isConnected) return;
  try {
    await producer.connect();
    isConnected = true;
    console.log('Kafka Producer connected successfully');
  } catch (error) {
    console.error('Error connecting Kafka Producer:', error);
  }
};

/**
 * Publishes a JSON transaction event to the transaction-events Kafka topic.
 * Automatically ensures the producer is connected before sending the payload.
 * @param {object} event - Message body containing transaction metadata
 */
export const publishTransactionEvent = async (event) => {
  try {
    await connectProducer();
    await producer.send({
      topic: 'transaction-events',
      messages: [
        {
          key: event.transaction_id || event.idempotency_key,
          value: JSON.stringify(event),
        },
      ],
    });
  } catch (error) {
    console.error('Error publishing event to Kafka:', error);
    // In a high-throughput financial system, if Kafka fails, we should still return success for the API, 
    // but log the event to a fallback table or system so background sync can pick it up.
  }
};

/**
 * Disconnects the Kafka producer client cleanly during server shutdown.
 */
export const disconnectProducer = async () => {
  if (!isConnected) return;
  try {
    await producer.disconnect();
    isConnected = false;
  } catch (err) {
    console.error('Error disconnecting Kafka Producer:', err);
  }
};

export { kafka };
