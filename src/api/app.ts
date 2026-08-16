import Fastify from 'fastify';
import { orderRoutes } from './routes/orders';

export async function buildApp() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'order-api',
    timestamp: new Date().toISOString(),
  }));

  await app.register(orderRoutes);

  return app;
}
