import { Channel, ConsumeMessage } from 'amqplib';
import { createHash } from 'node:crypto';
import { disconnectPrisma, prisma } from '../shared/db/prisma';
import { closeMessaging, getChannel } from '../shared/messaging/connection';
import { CONSUMER_SETTINGS, QUEUES } from '../shared/messaging/constants';
import { initTracing } from '../shared/observability/tracing';
import { inventoryRepository } from '../shared/repositories/inventory.repository';
import {
  InventoryReleaseEvent,
  OrderCreatedEvent,
} from '../shared/types/order';
import { handleOrderCreated, handleRelease } from './handlers/inventory.handler';

initTracing('inventory-worker');

function getMessageId(message: ConsumeMessage): string {
  if (message.properties.messageId) {
    return message.properties.messageId;
  }
  return createHash('sha256').update(message.content).digest('hex');
}

// Idempotency: skip redeliveries already processed (crashes/reconnects).
async function alreadyProcessed(messageId: string, queue: string): Promise<boolean> {
  const existing = await prisma.processedMessage.findUnique({
    where: { messageId },
  });
  if (existing) {
    return true;
  }
  await prisma.processedMessage.create({ data: { messageId, queue } });
  return false;
}

async function processReserve(
  channel: Channel,
  message: ConsumeMessage | null,
): Promise<void> {
  if (!message) return;
  const messageId = getMessageId(message);

  if (await alreadyProcessed(messageId, QUEUES.INVENTORY_RESERVE)) {
    channel.ack(message);
    return;
  }

  try {
    const event = JSON.parse(message.content.toString()) as OrderCreatedEvent;
    await handleOrderCreated(event);
    channel.ack(message);
  } catch (error) {
    console.error('Failed to reserve stock:', error);
    // Inventory reservation is not retried here; failure is communicated via
    // the inventory.reservation.failed event published inside the handler.
    channel.ack(message);
  }
}

async function processRelease(
  channel: Channel,
  message: ConsumeMessage | null,
): Promise<void> {
  if (!message) return;
  const messageId = getMessageId(message);

  if (await alreadyProcessed(messageId, QUEUES.INVENTORY_RELEASE)) {
    channel.ack(message);
    return;
  }

  try {
    const event = JSON.parse(message.content.toString()) as InventoryReleaseEvent;
    await handleRelease(event);
    channel.ack(message);
  } catch (error) {
    console.error('Failed to release stock:', error);
    channel.ack(message);
  }
}

async function startConsuming(): Promise<void> {
  const channel = await getChannel();
  await channel.prefetch(CONSUMER_SETTINGS.PREFETCH_COUNT);

  await channel.consume(QUEUES.INVENTORY_RESERVE, (message) => {
    void processReserve(channel, message);
  });
  await channel.consume(QUEUES.INVENTORY_RELEASE, (message) => {
    void processRelease(channel, message);
  });

  console.log(
    `Inventory worker listening on queues: ${QUEUES.INVENTORY_RESERVE}, ${QUEUES.INVENTORY_RELEASE}`,
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

inventoryRepository
  .ensureSeeded()
  .then(() => startConsuming())
  .catch((error) => {
    console.error('Failed to start inventory worker:', error);
    process.exit(1);
  });
