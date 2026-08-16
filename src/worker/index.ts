import { ConsumeMessage } from 'amqplib';
import { disconnectPrisma } from '../shared/db/prisma';
import { closeMessaging, getChannel } from '../shared/messaging/connection';
import { QUEUES } from '../shared/messaging/constants';
import { OrderCreatedEvent } from '../shared/types/order';
import { handleOrderCreated } from './handlers/order-created.handler';

async function processMessage(message: ConsumeMessage | null): Promise<void> {
  if (!message) {
    return;
  }

  try {
    const event = JSON.parse(message.content.toString()) as OrderCreatedEvent;
    await handleOrderCreated(event);

    const channel = await getChannel();
    channel.ack(message);
  } catch (error) {
    console.error('Failed to process message:', error);

    const channel = await getChannel();
    channel.nack(message, false, false);
  }
}

async function main(): Promise<void> {
  const channel = await getChannel();

  await channel.consume(QUEUES.ORDER_PROCESSING, (message) => {
    void processMessage(message);
  });

  console.log(`Worker listening on queue: ${QUEUES.ORDER_PROCESSING}`);
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down gracefully...`);
  await closeMessaging();
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((error) => {
  console.error('Failed to start worker:', error);
  process.exit(1);
});
