import amqp, { ConfirmChannel, RecoveringChannelModel } from 'amqplib';
import { env } from '../config/env';
import { logger } from '../observability/logger';
import {
  CONSUMER_SETTINGS,
  DEAD_LETTER_EXCHANGE_NAME,
  EXCHANGE_NAME,
  QUEUES,
  ROUTING_KEYS,
} from './constants';

let connection: RecoveringChannelModel | null = null;
let channel: ConfirmChannel | null = null;
let connecting: Promise<ConfirmChannel> | null = null;

/**
 * amqplib 2.x `recovery` option auto-reconnects the connection and recovers
 * channels (re-declares the topology and re-registers consumers). No hand-rolled
 * reconnect loop is needed; callers just await getChannel() and publish.
 *
 * A confirm channel is used so publishers can wait for a broker ack before
 * treating a message as delivered (required by the transactional outbox).
 */
export async function getChannel(): Promise<ConfirmChannel> {
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

async function establishChannel(): Promise<ConfirmChannel> {
  const conn = await amqp.connect(env.RABBITMQ_URL, { recovery: true });

  conn.on('error', (error: Error) => {
    logger.error({ err: error }, 'RabbitMQ connection error');
  });
  // RecoveringChannelModel emits 'disconnect' (not 'close') while it retries.
  conn.on('disconnect', (error: Error) => {
    logger.warn(
      { err: error },
      'RabbitMQ disconnected — amqplib will auto-recover',
    );
    channel = null;
    connection = null;
  });

  const ch = await conn.createConfirmChannel();
  await assertTopology(ch);

  connection = conn;
  channel = ch;
  logger.info('Connected to RabbitMQ');

  return ch;
}

/**
 * Retryable work queue: rejected messages dead-letter to the DLX, while
 * delayed retries park in a TTL queue that routes back to the main queue.
 */
async function assertRetryableQueue(
  ch: ConfirmChannel,
  queue: string,
  retryQueue: string,
  dlq: string,
  deadRoutingKey: string,
): Promise<void> {
  await ch.assertQueue(queue, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE_NAME,
      'x-dead-letter-routing-key': deadRoutingKey,
    },
  });
  await ch.assertQueue(retryQueue, {
    durable: true,
    arguments: {
      'x-message-ttl': CONSUMER_SETTINGS.RETRY_DELAY_MS,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': queue,
    },
  });
  await ch.assertQueue(dlq, { durable: true });
  await ch.bindQueue(dlq, DEAD_LETTER_EXCHANGE_NAME, deadRoutingKey);
}

async function assertTopology(ch: ConfirmChannel): Promise<void> {
  await ch.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
  await ch.assertExchange(DEAD_LETTER_EXCHANGE_NAME, 'direct', {
    durable: true,
  });

  await assertRetryableQueue(
    ch,
    QUEUES.ORDER_PROCESSING,
    QUEUES.ORDER_PROCESSING_RETRY,
    QUEUES.ORDER_PROCESSING_DLQ,
    ROUTING_KEYS.ORDER_PROCESSING_DEAD,
  );
  // The worker reacts to inventory events (the order is only confirmed
  // once stock has been reserved by the inventory service).
  await ch.bindQueue(
    QUEUES.ORDER_PROCESSING,
    EXCHANGE_NAME,
    ROUTING_KEYS.INVENTORY_RESERVED,
  );
  await ch.bindQueue(
    QUEUES.ORDER_PROCESSING,
    EXCHANGE_NAME,
    ROUTING_KEYS.INVENTORY_RESERVATION_FAILED,
  );

  // Inventory service: reserve stock when an order is created.
  await assertRetryableQueue(
    ch,
    QUEUES.INVENTORY_RESERVE,
    QUEUES.INVENTORY_RESERVE_RETRY,
    QUEUES.INVENTORY_RESERVE_DLQ,
    ROUTING_KEYS.INVENTORY_RESERVE_DEAD,
  );
  await ch.bindQueue(
    QUEUES.INVENTORY_RESERVE,
    EXCHANGE_NAME,
    ROUTING_KEYS.ORDER_CREATED,
  );

  // Inventory service: release previously reserved stock (compensation).
  await assertRetryableQueue(
    ch,
    QUEUES.INVENTORY_RELEASE,
    QUEUES.INVENTORY_RELEASE_RETRY,
    QUEUES.INVENTORY_RELEASE_DLQ,
    ROUTING_KEYS.INVENTORY_RELEASE_DEAD,
  );
  await ch.bindQueue(
    QUEUES.INVENTORY_RELEASE,
    EXCHANGE_NAME,
    ROUTING_KEYS.INVENTORY_RELEASE,
  );

  // Fan-out of processed order events to the notification worker.
  await assertRetryableQueue(
    ch,
    QUEUES.ORDER_NOTIFICATIONS,
    QUEUES.ORDER_NOTIFICATIONS_RETRY,
    QUEUES.ORDER_NOTIFICATIONS_DLQ,
    ROUTING_KEYS.ORDER_NOTIFICATIONS_DEAD,
  );
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
      logger.error({ err: error }, 'Error while closing RabbitMQ connection');
    }
  }
}

// Liveness/readiness signal: true once the channel has been asserted and is
// still open. Lets the API report whether it can actually reach the broker.
export function isMessagingConnected(): boolean {
  return (
    channel !== null && !(channel as unknown as { closed: boolean }).closed
  );
}
