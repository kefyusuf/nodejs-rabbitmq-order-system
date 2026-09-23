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
import { inventoryRepository } from '../shared/repositories/inventory.repository';
import {
  InventoryReleaseEvent,
  OrderCreatedEvent,
} from '../shared/types/order';
import {
  handleOrderCreated,
  handleRelease,
} from './handlers/inventory.handler';

registerFaultHandlers();
initTracing('inventory-worker');

const RETRY_HEADER = 'x-retry-count';

function getRetryCount(message: ConsumeMessage): number {
  const value = message.properties.headers?.[RETRY_HEADER];
  return typeof value === 'number' ? value : 0;
}

async function handleWithRetry(
  channel: Channel,
  message: ConsumeMessage,
  queue: string,
  retryQueue: string,
  dlq: string,
  run: (eventJson: string) => Promise<void>,
): Promise<void> {
  const messageId = getMessageId(message);

  // Claim only after success so a crash mid-handler does not swallow the message.
  if (await isAlreadyProcessed(messageId)) {
    channel.ack(message);
    return;
  }

  try {
    await run(message.content.toString());
    await markProcessed(messageId, queue);
    channel.ack(message);
  } catch (error) {
    const retryCount = getRetryCount(message);

    // Malformed payloads will never succeed — skip retries and DLQ them.
    if (error instanceof SyntaxError) {
      logger.error(
        { err: error },
        `Malformed message, dead-lettering to ${dlq}`,
      );
      channel.nack(message, false, false);
      return;
    }

    logger.error({ err: error }, `Failed to process ${queue} message`);
    if (retryCount < CONSUMER_SETTINGS.MAX_RETRIES) {
      await republishForRetry(
        retryQueue,
        message.content,
        message.properties,
        RETRY_HEADER,
        retryCount + 1,
      );
      channel.ack(message);
    } else {
      channel.nack(message, false, false);
      logger.error(`Message moved to dead letter queue: ${dlq}`);
    }
  }
}

async function startConsuming(): Promise<void> {
  const channel = await getChannel();
  await channel.prefetch(CONSUMER_SETTINGS.PREFETCH_COUNT);

  await channel.consume(QUEUES.INVENTORY_RESERVE, (message) => {
    if (!message) return;
    void handleWithRetry(
      channel,
      message,
      QUEUES.INVENTORY_RESERVE,
      QUEUES.INVENTORY_RESERVE_RETRY,
      QUEUES.INVENTORY_RESERVE_DLQ,
      async (body) => {
        const event = JSON.parse(body) as OrderCreatedEvent;
        await handleOrderCreated(event);
      },
    );
  });

  await channel.consume(QUEUES.INVENTORY_RELEASE, (message) => {
    if (!message) return;
    void handleWithRetry(
      channel,
      message,
      QUEUES.INVENTORY_RELEASE,
      QUEUES.INVENTORY_RELEASE_RETRY,
      QUEUES.INVENTORY_RELEASE_DLQ,
      async (body) => {
        const event = JSON.parse(body) as InventoryReleaseEvent;
        await handleRelease(event);
      },
    );
  });

  logger.info(
    `Inventory worker listening on queues: ${QUEUES.INVENTORY_RESERVE}, ${QUEUES.INVENTORY_RELEASE}`,
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

inventoryRepository
  .ensureSeeded()
  .then(() => startConsuming())
  .catch((error) => {
    logger.error({ err: error }, 'Failed to start inventory worker');
    process.exit(1);
  });
