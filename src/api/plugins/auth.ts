import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fp from 'fastify-plugin';
import { env } from '../../shared/config/env';

/**
 * Registers @fastify/jwt and a reusable `authenticate` decorator.
 * Wrapped with `fastify-plugin` so the decorator leaks to the root app and
 * is visible to sibling plugins (e.g. the order routes), not just children
 * of this plugin.
 */
async function authPlugin(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, { secret: env.JWT_SECRET });

  app.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    },
  );
}

export default fp(authPlugin);
