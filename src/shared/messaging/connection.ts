import amqp, { Channel, ChannelModel } from 'amqplib';
import { env } from '../config/env';
import {
  CONSUMER_SETTINGS,
  DEAD_LETTER_EXCHANGE_NAME,
  EXCHANGE_NAME,
  QUEUES,
  ROUTING_KEYS,
} from './constants';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let connecting: Promise<Channel> | null = null;

/**
 * amqplib 0.10 'recovery' option auto-reconnects the connection and recovers
 * channels (re-declares the topology and re-registers consumers). No hand-rolled
 * reconnect loop is needed; callers just await getChannel() and publish.
 */
export async function getChannel(): Promise<Channel> {
  if (channel) {
    return channel;
  }

  if (!connecting) {
    connecting = establishChannel().finally(() => {
      connecting = null;
    });
  }

  return connecting;
}

async function establishChannel(): Promise<Channel> {
  const conn = await amqp.connect(env.RABBITMQ_URL, { recovery: true });

  conn.on('error', (error: Error) => {
    console.error('RabbitMQ connection error:', error.message);
  });
  conn.on('close', () => {
    console.warn('RabbitMQ connection closed — amqplib will auto-recover');
    channel = null;
    connection = null;
  });

  const ch = await conn.createChannel();
  await assertTopology(ch);

  connection = conn;
  channel = ch;
  console.log('Connected to RabbitMQ');

  return ch;
}

async function assertTopology(ch: Channel): Promise<void> {
  await ch.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
  await ch.assertExchange(DEAD_LETTER_EXCHANGE_NAME, 'direct', {
    durable: true,
  });

  // Rejected messages from the main queue are dead-lettered to orders.dlx.
  await ch.assertQueue(QUEUES.ORDER_PROCESSING, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE_NAME,
      'x-dead-letter-routing-key': ROUTING_KEYS.ORDER_PROCESSING_DEAD,
    },
  });
  await ch.bindQueue(
    QUEUES.ORDER_PROCESSING,
    EXCHANGE_NAME,
    ROUTING_KEYS.ORDER_CREATED,
  );

  // Expired retry messages are routed back to the main queue via the
  // default exchange, preserving their headers (x-retry-count).
  await ch.assertQueue(QUEUES.ORDER_PROCESSING_RETRY, {
    durable: true,
    arguments: {
      'x-message-ttl': CONSUMER_SETTINGS.RETRY_DELAY_MS,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': QUEUES.ORDER_PROCESSING,
    },
  });

  await ch.assertQueue(QUEUES.ORDER_PROCESSING_DLQ, { durable: true });
  await ch.bindQueue(
    QUEUES.ORDER_PROCESSING_DLQ,
    DEAD_LETTER_EXCHANGE_NAME,
    ROUTING_KEYS.ORDER_PROCESSING_DEAD,
  );

  // Fan-out of processed order events to the notification worker.
  await ch.assertQueue(QUEUES.ORDER_NOTIFICATIONS, { durable: true });
  await ch.bindQueue(
    QUEUES.ORDER_NOTIFICATIONS,
    EXCHANGE_NAME,
    ROUTING_KEYS.ORDER_CONFIRMED,
  );
  await ch.bindQueue(
    QUEUES.ORDER_NOTIFICATIONS,
    EXCHANGE_NAME,
    ROUTING_KEYS.ORDER_FAILED,
  );
}

export async function closeMessaging(): Promise<void> {
  const conn = connection;
  channel = null;
  connection = null;

  if (conn) {
    try {
      await conn.close();
    } catch (error) {
      console.error('Error while closing RabbitMQ connection:', error);
    }
  }
}
