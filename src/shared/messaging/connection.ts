import amqp, { Channel, ChannelModel } from 'amqplib';
import { env } from '../config/env';
import {
  CONSUMER_SETTINGS,
  DEAD_LETTER_EXCHANGE_NAME,
  EXCHANGE_NAME,
  QUEUES,
  ROUTING_KEYS,
} from './constants';

type ReconnectListener = (channel: Channel) => void;

// Bounded attempts for callers like the API: a request must fail fast-ish
// when the broker is unreachable instead of hanging until it comes back.
const CONNECT_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let connecting: Promise<Channel> | null = null;
let intentionallyClosed = false;
let reconnecting = false;
const reconnectListeners: ReconnectListener[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function onMessagingReconnected(listener: ReconnectListener): void {
  reconnectListeners.push(listener);
}

/**
 * Returns the current channel, connecting (with limited retries) if needed.
 * Throws when the broker stays unreachable so callers can decide what to do.
 */
export async function getChannel(): Promise<Channel> {
  if (channel) {
    return channel;
  }

  if (!connecting) {
    intentionallyClosed = false;
    connecting = establishChannel().finally(() => {
      connecting = null;
    });
  }

  return connecting;
}

async function establishChannel(): Promise<Channel> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      const conn = await amqp.connect(env.RABBITMQ_URL);

      conn.on('error', (error: Error) => {
        // The 'close' event that follows triggers the recovery flow.
        console.error('RabbitMQ connection error:', error.message);
      });
      conn.on('close', () => handleConnectionClosed());

      const ch = await conn.createChannel();
      await assertTopology(ch);

      connection = conn;
      channel = ch;
      console.log('Connected to RabbitMQ');

      return ch;
    } catch (error) {
      lastError = error;
      if (attempt < CONNECT_ATTEMPTS) {
        const delay = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
        console.warn(
          `RabbitMQ connect attempt ${attempt}/${CONNECT_ATTEMPTS} failed, retrying in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function handleConnectionClosed(): void {
  if (intentionallyClosed) {
    return;
  }
  if (!channel && !connection) {
    return;
  }

  console.warn('RabbitMQ connection lost');
  channel = null;
  connection = null;

  // Services with long-lived consumers (the workers) need the connection
  // back even without new traffic; the API reconnects lazily on next publish.
  if (reconnectListeners.length > 0) {
    void reconnectForever();
  }
}

async function reconnectForever(): Promise<void> {
  if (reconnecting) {
    return;
  }
  reconnecting = true;

  let attempt = 0;
  while (!channel) {
    attempt += 1;
    try {
      const ch = await getChannel();
      console.log(`RabbitMQ reconnected after ${attempt} attempt(s)`);
      for (const listener of reconnectListeners) {
        listener(ch);
      }
    } catch {
      const delay = Math.min(
        INITIAL_BACKOFF_MS * 2 ** (attempt - 1),
        MAX_BACKOFF_MS,
      );
      console.warn(
        `RabbitMQ reconnect attempt ${attempt} failed, retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  reconnecting = false;
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
}

export async function closeMessaging(): Promise<void> {
  intentionallyClosed = true;

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
