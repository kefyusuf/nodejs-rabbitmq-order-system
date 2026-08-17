import { env } from '../config/env';
import type { OrderStore } from './OrderStore';
import { InMemoryOrderStore } from './in-memory';
import { RedisOrderStore } from './redis';

/**
 * mid seviyesinde in-memory ve redis adapter'ları vardır.
 * hero'da postgres adapter'ı eklenir.
 */
export function createOrderStore(): OrderStore {
  switch (env.STORE) {
    case 'redis':
      return new RedisOrderStore(env.REDIS_URL);
    case 'in-memory':
    default:
      return new InMemoryOrderStore();
  }
}

export const orderStore: OrderStore = createOrderStore();

export type { OrderRecord, OrderStore } from './OrderStore';
