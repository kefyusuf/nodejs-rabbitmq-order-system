import { Channel, ConsumeMessage } from 'amqplib';
import { closeMessaging, getChannel } from '../shared/messaging/connection';
import { CONSUMER_SETTINGS, QUEUES } from '../shared/messaging/constants';
import { initTracing } from '../shared/observability/tracing';
import { OrderProcessedEvent } from '../shared/types/order';
import { handleOrderProcessed } from './handlers/order-processed.handler';

initTracing('order-notification');

async function processMessage(
  channel: Channel,
  message: ConsumeMessage | null,
): Promise<void> {
  if (!message) {
    return;
  }

  try {
    const event = JSON.parse(message.content.toString()) as OrderProcessedEvent;
    await handleOrderProcessed(event);
  } catch (error) {
    // Notifications are best-effort: a malformed event is logged and
    // dropped rather than retried forever.
    console.error('Dropping unprocessable notification event:', error);
  } finally {
    channel.ack(message);
  }
}

async function startConsuming(): Promise<void> {
  const channel = await getChannel();
  await channel.prefetch(CONSUMER_SETTINGS.PREFETCH_COUNT);

  await channel.consume(QUEUES.ORDER_NOTIFICATIONS, (message) => {
    void processMessage(channel, message);
  });

  console.log(
    `Notification worker listening on queue: ${QUEUES.ORDER_NOTIFICATIONS}`,
  );
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down gracefully...`);
  await closeMessaging();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

startConsuming().catch((error) => {
  console.error('Failed to start notification worker:', error);
  process.exit(1);
});
