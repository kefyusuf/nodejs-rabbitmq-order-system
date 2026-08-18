import { env } from '../shared/config/env';
import { disconnectPrisma } from '../shared/db/prisma';
import { closeMessaging } from '../shared/messaging/connection';
import { registerFaultHandlers } from '../shared/process/process';
import { buildApp } from './app';

registerFaultHandlers();

let app: Awaited<ReturnType<typeof buildApp>> | undefined;

async function main(): Promise<void> {
  app = await buildApp();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Order API listening on port ${env.PORT}`);
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down gracefully...`);
  await closeMessaging();
  await disconnectPrisma();
  // Drain in-flight HTTP requests before exiting.
  if (app) await app.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((error) => {
  console.error('Failed to start API:', error);
  process.exit(1);
});
