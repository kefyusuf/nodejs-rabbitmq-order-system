import Fastify, { FastifyHttpOptions } from 'fastify';
import { orderRoutes } from './routes/orders';

export interface BuildAppOptions {
  logger?: FastifyHttpOptions<never>['logger'];
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'order-api',
    timestamp: new Date().toISOString(),
  }));

  await app.register(orderRoutes);

  return app;
}
