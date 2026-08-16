import { env } from '../shared/config/env';
import { disconnectPrisma } from '../shared/db/prisma';
import { closeMessaging } from '../shared/messaging/connection';
import { buildApp } from './app';

async function main(): Promise<void> {
  const app = await buildApp();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Order API listening on port ${env.PORT}`);
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
  console.error('Failed to start API:', error);
  process.exit(1);
});
