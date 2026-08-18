import Fastify, { FastifyHttpOptions } from 'fastify';
import { orderRoutes } from './routes/orders';
import { inventoryRoutes } from './routes/inventory';
import authPlugin from './plugins/auth';
import {
  httpRequestDurationSeconds,
  registry,
} from '../shared/observability/metrics';
import { initTracing } from '../shared/observability/tracing';

export interface BuildAppOptions {
  logger?: FastifyHttpOptions<never>['logger'];
}

export async function buildApp(options: BuildAppOptions = {}) {
  initTracing('order-api');

  const app = Fastify({ logger: options.logger ?? true });

  app.addHook('onResponse', (request, reply, done) => {
    const duration = reply.elapsedTime / 1000;
    httpRequestDurationSeconds.observe(
      {
        method: request.method,
        route: request.routeOptions.url ?? 'unknown',
        status: reply.statusCode,
      },
      duration,
    );
    done();
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'order-api',
    timestamp: new Date().toISOString(),
  }));

  // Prometheus scrape endpoint (public, no auth).
  app.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  // `authPlugin` is wrapped with fastify-plugin, so its decorators (`jwt`,
  // `authenticate`) leak to the root app and are visible to the order routes.
  await app.register(authPlugin);

  // Demo token issuer. In production, exchange real credentials here.
  app.post('/auth/token', async (request) => {
    const body = (request.body ?? {}) as { username?: string };
    return { token: app.jwt.sign({ sub: body.username ?? 'demo' }) };
  });

  await app.register(orderRoutes);
  await app.register(inventoryRoutes);

  return app;
}
