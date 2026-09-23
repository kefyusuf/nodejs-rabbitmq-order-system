import { env } from '../config/env';
import type { OrderStore } from './OrderStore';
import { InMemoryOrderStore } from './in-memory';
import { RedisOrderStore } from './redis';
import { PostgresOrderStore } from './postgres';

/**
 * Selects the adapter based on the STORE env value.
 *
 *  in-memory  : beginner (single process)
 *  redis      : mid      (ioredis, multi-process)
 *  postgres   : hero     (Prisma, default)
 */
export function createOrderStore(): OrderStore {
  switch (env.STORE) {
    case 'redis':
      return new RedisOrderStore(env.REDIS_URL);
    case 'postgres':
      return new PostgresOrderStore();
    case 'in-memory':
    default:
      return new InMemoryOrderStore();
  }
}

export const orderStore: OrderStore = createOrderStore();

export type { OrderRecord, OrderStore } from './OrderStore';
