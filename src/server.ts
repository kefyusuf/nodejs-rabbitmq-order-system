/**
 * beginner giriş noktası — API ve worker AYNI node sürecinde.
 *
 * Neden? beginner seviyesinde STORE=in-memory (RAM), yani durum süreç içinde
 * paylaşılır. Eğer api ve worker ayrı süreçlerde olsalardı, worker'ın güncellediği
 * PENDING→CONFIRMED sipariş, api'ye hiç ulaşamaz. Tek süreç = hafiflik + anlaşılırlık.
 *
 * mid/hero seviyelerinde STORE dışa aktarılır (redis/postgres) ve api/worker
 * ayrı süreçlerde, docker compose ile ölçeklendirilir (bakarız README'ye).
 */
import { env } from './shared/config/env';
import { buildApp } from './api/app';
import { getChannel, closeMessaging } from './shared/messaging/connection';
import { QUEUES, CONSUMER_SETTINGS } from './shared/messaging/constants';
import { handleOrderCreated } from './worker/handlers/order-created.handler';
import type { OrderCreatedEvent } from './shared/types/order';

async function startConsumer(): Promise<void> {
  const channel = await getChannel();
  await channel.prefetch(CONSUMER_SETTINGS.PREFETCH_COUNT);

  await channel.consume(QUEUES.ORDER_PROCESSING, async (msg) => {
    if (!msg) return;
    try {
      const event = JSON.parse(msg.content.toString()) as OrderCreatedEvent;
      await handleOrderCreated(event);
      channel.ack(msg);
    } catch (error) {
      console.error('order.created işlenirken hata:', error);
      // beginner: retry için requeue (mid seviyesinde DLQ + retry queue gelir).
      channel.nack(msg, false, true);
    }
  });

  console.log(`Beginner consumer hazır: ${QUEUES.ORDER_PROCESSING}`);
}

async function main(): Promise<void> {
  await startConsumer();

  const app = await buildApp();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(
    `Beginner server (api + worker tek süreçte) dinliyor: ${env.PORT}`,
  );
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down gracefully...`);
  await closeMessaging();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
