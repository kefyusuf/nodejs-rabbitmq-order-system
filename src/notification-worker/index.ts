import { Channel, ConsumeMessage } from 'amqplib';
import { disconnectPrisma } from '../shared/db/prisma';
import { closeMessaging, getChannel } from '../shared/messaging/connection';
import {
  getMessageId,
  isAlreadyProcessed,
  markProcessed,
} from '../shared/messaging/idempotency';
import { CONSUMER_SETTINGS, QUEUES } from '../shared/messaging/constants';
import { republishForRetry } from '../shared/messaging/publisher';
import { logger } from '../shared/observability/logger';
import { initTracing } from '../shared/observability/tracing';
import { registerFaultHandlers } from '../shared/process/process';
import { OrderProcessedEvent } from '../shared/types/order';
import { handleOrderProcessed } from './handlers/order-processed.handler';

registerFaultHandlers();
initTracing('order-notification');

const RETRY_HEADER = 'x-retry-count';

function getRetryCount(message: ConsumeMessage): number {
  const value = message.properties.headers?.[RETRY_HEADER];
  return typeof value === 'number' ? value : 0;
}

async function processMessage(
  channel: Channel,
  message: ConsumeMessage | null,
): Promise<void> {
  if (!message) {
    return;
  }

  const messageId = getMessageId(message);

  // Idempotency: at-least-once delivery must not send duplicate emails.
  if (await isAlreadyProcessed(messageId)) {
    channel.ack(message);
    return;
  }

  try {
    const event = JSON.parse(message.content.toString()) as OrderProcessedEvent;
    await handleOrderProcessed(event);
    await markProcessed(messageId, QUEUES.ORDER_NOTIFICATIONS);
    channel.ack(message);
  } catch (error) {
    // Malformed events are dropped; transient mail failures are retried.
    if (error instanceof SyntaxError) {
      logger.error({ err: error }, 'Dropping unprocessable notification event');
      channel.ack(message);
      return;
    }

    const retryCount = getRetryCount(message);
    logger.error({ err: error }, 'Failed to send notification');

    if (retryCount < CONSUMER_SETTINGS.MAX_RETRIES) {
      await republishForRetry(
        QUEUES.ORDER_NOTIFICATIONS_RETRY,
        message.content,
        message.properties,
        RETRY_HEADER,
        retryCount + 1,
      );
      channel.ack(message);
    } else {
      channel.nack(message, false, false);
      logger.error(
        `Message moved to dead letter queue: ${QUEUES.ORDER_NOTIFICATIONS_DLQ}`,
      );
    }
  }
}

async function startConsuming(): Promise<void> {
  const channel = await getChannel();
  await channel.prefetch(CONSUMER_SETTINGS.PREFETCH_COUNT);

  await channel.consume(QUEUES.ORDER_NOTIFICATIONS, (message) => {
    void processMessage(channel, message);
  });

  logger.info(
    `Notification worker listening on queue: ${QUEUES.ORDER_NOTIFICATIONS}`,
  );
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  await closeMessaging();
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

startConsuming().catch((error) => {
  logger.error({ err: error }, 'Failed to start notification worker');
  process.exit(1);
});
