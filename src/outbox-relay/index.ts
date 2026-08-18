import { closeMessaging, getChannel } from '../shared/messaging/connection';
import { orderEventsPublishedTotal } from '../shared/observability/metrics';
import { prisma } from '../shared/db/prisma';
import { publishMessage } from '../shared/messaging/publisher';
import { initTracing } from '../shared/observability/tracing';
import { registerFaultHandlers } from '../shared/process/process';

registerFaultHandlers();
initTracing('order-outbox-relay');

const POLL_INTERVAL_MS = 1000;

type OutboxRow = { id: string; type: string; payload: unknown };

/**
 * Transactional outbox relay: reads unpublished outbox rows (FOR UPDATE
 * SKIP LOCKED so multiple relay replicas don't double-publish), publishes
 * each event to RabbitMQ, then marks it published. At-least-once delivery:
 * if the relay dies after publishing but before marking, the row is retried
 * and consumers dedupe via the message id.
 */
async function publishPending(): Promise<void> {
  await getChannel();

  const rows = await prisma.$transaction(async (tx) => {
    const pending = await tx.$queryRawUnsafe<OutboxRow[]>(
      `SELECT * FROM "Outbox" WHERE "published" = false ORDER BY "createdAt" ASC LIMIT 50 FOR UPDATE SKIP LOCKED`,
    );

    for (const row of pending) {
      await publishMessage(row.type, row.payload, row.id);
      await tx.outbox.update({ where: { id: row.id }, data: { published: true } });
    }

    return pending;
  });

  if (rows.length > 0) {
    orderEventsPublishedTotal.inc(rows.length);
    console.log(`Outbox relay published ${rows.length} event(s)`);
  }
}

let timer: NodeJS.Timeout | undefined;

async function main(): Promise<void> {
  await getChannel();
  console.log('Outbox relay started');
  timer = setInterval(() => {
    void publishPending().catch((error) =>
      console.error('Outbox relay error:', error),
    );
  }, POLL_INTERVAL_MS);
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down gracefully...`);
  if (timer) clearInterval(timer);
  await closeMessaging();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((error) => {
  console.error('Failed to start outbox relay:', error);
  process.exit(1);
});
