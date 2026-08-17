import { env } from '../config/env';
import type { OrderStore } from './OrderStore';
import { InMemoryOrderStore } from './in-memory';

/**
 * beginner seviyesinde yalnızca in‑memory adapter vardır.
 * mid/hero seviyelerinde redis/postgres adapter'ları eklenir.
 */
export function createOrderStore(): OrderStore {
  switch (env.STORE) {
    case 'in-memory':
    default:
      return new InMemoryOrderStore();
  }
}

export const orderStore: OrderStore = createOrderStore();

export type { OrderRecord, OrderStore } from './OrderStore';
