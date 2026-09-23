import { orderStore } from '../storage';
import type { OrderRecord, OrderStore } from '../storage/OrderStore';

/**
 * Persistence goes through the `OrderStore` adapter; this module keeps the
 * `orderRepository` name for backwards compatibility.
 *
 * The active adapter is selected by the `STORE` env value
 * (in-memory | redis | postgres).
 */
export const orderRepository: OrderStore = orderStore;

export type { OrderRecord };
