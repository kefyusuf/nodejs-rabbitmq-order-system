import { Channel, ConsumeMessage } from 'amqplib';
import { createHash } from 'node:crypto';
import { disconnectPrisma, prisma } from '../shared/db/prisma';
import { closeMessaging, getChannel } from '../shared/messaging/connection';
import { CONSUMER_SETTINGS, QUEUES } from '../shared/messaging/constants';
import { orderEventsProcessedTotal } from '../shared/observability/metrics';
import { initTracing } from '../shared/observability/tracing';
import { OrderCreatedEvent } from '../shared/types/order';
import { handleOrderCreated } from './handlers/order-created.handler';

initTracing('order-worker');

const RETRY_HEADER = 'x-retry-count';

function getRetryCount(message: ConsumeMessage): number {
  const value = message.properties.headers?.[RETRY_HEADER];
  return typeof value === 'number' ? value : 0;
}

function getMessageId(message: ConsumeMessage): string {
  if (message.properties.messageId) {
    return message.properties.messageId;
  }
  return createHash('sha256').update(message.content).digest('hex');
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
  const already = await prisma.processedMessage.findUnique({
    where: { messageId },
  });
  if (already) {
    channel.ack(message);
    return;
  }

  try {
    const event = JSON.parse(message.content.toString()) as OrderCreatedEvent;
    await handleOrderCreated(event);
    await prisma.processedMessage.create({
      data: { messageId, queue: QUEUES.ORDER_PROCESSING },
    });
    orderEventsProcessedTotal.inc();
    channel.ack(message);
  } catch (error) {
    const retryCount = getRetryCount(message);
    console.error(
      `Failed to process message (retry ${retryCount}/${CONSUMER_SETTINGS.MAX_RETRIES}):`,
      error,
    );

    if (retryCount < CONSUMER_SETTINGS.MAX_RETRIES) {
      channel.publish('', QUEUES.ORDER_PROCESSING_RETRY, message.content, {
        contentType: 'application/json',
        persistent: true,
        headers: { [RETRY_HEADER]: retryCount + 1 },
      });
      channel.ack(message);
      console.warn(
        `Message scheduled for retry in ${CONSUMER_SETTINGS.RETRY_DELAY_MS}ms`,
      );
    } else {
      // Requeue=false dead-letters the message to orders.dlx -> DLQ.
      channel.nack(message, false, false);
      console.error(
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

  console.log(
    `Worker listening on queue: ${QUEUES.ORDER_PROCESSING} (prefetch: ${CONSUMER_SETTINGS.PREFETCH_COUNT})`,
  );
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down gracefully...`);
  await closeMessaging();
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

startConsuming().catch((error) => {
  console.error('Failed to start worker:', error);
  process.exit(1);
});
