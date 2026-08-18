import Fastify, { FastifyHttpOptions } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { orderRoutes } from './routes/orders';
import { inventoryRoutes } from './routes/inventory';
import authPlugin from './plugins/auth';
import {
  httpRequestDurationSeconds,
  registry,
} from '../shared/observability/metrics';
import { loggerOptions } from '../shared/observability/logger';
import { env } from '../shared/config/env';
import { prisma } from '../shared/db/prisma';
import { isMessagingConnected } from '../shared/messaging/connection';
import { initTracing } from '../shared/observability/tracing';

export interface BuildAppOptions {
  logger?: FastifyHttpOptions<never>['logger'];
}

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function buildApp(options: BuildAppOptions = {}) {
  initTracing('order-api');

  const app = Fastify({
    // 1 MiB request body cap (orders never exceed this).
    bodyLimit: 1_048_576,
    logger: options.logger ?? loggerOptions,
  });

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

  // Liveness: the process is up. Readiness: deps are reachable.
  app.get('/ready', async (_request, reply) => {
    const dbOk = await checkDatabase();
    const brokerOk = isMessagingConnected();
    if (!dbOk || !brokerOk) {
      reply.code(503);
      return {
        status: 'error',
        database: dbOk,
        messaging: brokerOk,
        timestamp: new Date().toISOString(),
      };
    }
    return {
      status: 'ok',
      service: 'order-api',
      database: true,
      messaging: true,
      timestamp: new Date().toISOString(),
    };
  });

  await app.register(cors, {
    // No CORS by default; browsers are blocked unless CORS_ORIGIN is set.
    origin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',') : false,
  });
  // Global request cap so a runaway client can't saturate the API.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
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
