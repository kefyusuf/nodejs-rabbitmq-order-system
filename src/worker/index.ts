import { Channel, ConsumeMessage } from 'amqplib';
import { disconnectPrisma } from '../shared/db/prisma';
import { closeMessaging, getChannel } from '../shared/messaging/connection';
import {
  getMessageId,
  isAlreadyProcessed,
  markProcessed,
} from '../shared/messaging/idempotency';
import {
  CONSUMER_SETTINGS,
  QUEUES,
  ROUTING_KEYS,
} from '../shared/messaging/constants';
import { republishForRetry } from '../shared/messaging/publisher';
import {
  orderEventsDeadLetteredTotal,
  orderEventsProcessedTotal,
} from '../shared/observability/metrics';
import { logger } from '../shared/observability/logger';
import { initTracing } from '../shared/observability/tracing';
import { registerFaultHandlers } from '../shared/process/process';
import {
  InventoryReservedEvent,
  InventoryReservationFailedEvent,
} from '../shared/types/order';
import {
  handleInventoryFailed,
  handleInventoryReserved,
} from './handlers/inventory-events.handler';

registerFaultHandlers();
initTracing('order-worker');

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

  // Idempotency: skip redeliveries that were already processed
  // (retries after a crash, or reconnects that replay unacked messages).
  if (await isAlreadyProcessed(messageId)) {
    channel.ack(message);
    return;
  }

  try {
    // The worker reacts to inventory saga events, not order.created directly:
    // the order is only confirmed after stock has been reserved.
    if (
      message.fields.routingKey === ROUTING_KEYS.INVENTORY_RESERVATION_FAILED
    ) {
      const event = JSON.parse(
        message.content.toString(),
      ) as InventoryReservationFailedEvent;
      await handleInventoryFailed(event);
    } else {
      const event = JSON.parse(
        message.content.toString(),
      ) as InventoryReservedEvent;
      await handleInventoryReserved(event);
    }

    await markProcessed(messageId, QUEUES.ORDER_PROCESSING);
    orderEventsProcessedTotal.inc();
    channel.ack(message);
  } catch (error) {
    const retryCount = getRetryCount(message);
    console.error(
      `Failed to process message (retry ${retryCount}/${CONSUMER_SETTINGS.MAX_RETRIES}):`,
      error,
    );

    if (retryCount < CONSUMER_SETTINGS.MAX_RETRIES) {
      // Preserve messageId so outbox redeliveries still dedupe after a retry.
      await republishForRetry(
        QUEUES.ORDER_PROCESSING_RETRY,
        message.content,
        message.properties,
        RETRY_HEADER,
        retryCount + 1,
      );
      channel.ack(message);
      logger.warn(
        `Message scheduled for retry in ${CONSUMER_SETTINGS.RETRY_DELAY_MS}ms (attempt ${retryCount + 1}/${CONSUMER_SETTINGS.MAX_RETRIES})`,
      );
    } else {
      // Requeue=false dead-letters the message to orders.dlx -> DLQ.
      channel.nack(message, false, false);
      orderEventsDeadLetteredTotal.inc();
      logger.error(
        `Message moved to dead letter queue: ${QUEUES.ORDER_PROCESSING_DLQ}`,
      );
    }
  }
}

async function startConsuming(): Promise<void> {
  const channel = await getChannel();
  await channel.prefetch(CONSUMER_SETTINGS.PREFETCH_COUNT);

  await channel.consume(QUEUES.ORDER_PROCESSING, (message) => {
    void processMessage(channel, message);
  });

  logger.info(
    `Worker listening on queue: ${QUEUES.ORDER_PROCESSING} (prefetch: ${CONSUMER_SETTINGS.PREFETCH_COUNT})`,
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
  logger.error({ err: error }, 'Failed to start worker');
  process.exit(1);
});
