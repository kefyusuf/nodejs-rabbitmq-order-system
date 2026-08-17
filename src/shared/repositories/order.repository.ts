import { orderStore } from '../storage';
import type { OrderRecord, OrderStore } from '../storage/OrderStore';

/**
 * Depolama artık `OrderStore` adapter aracılığıyla yapılır; bu dosya
 * geriye dönük uyumluluk için `orderRepository` ismini korur.
 *
 * Hangi adapterin aktif olduğu `STORE` env değerinden gelir
 * (in‑memory | redis | postgres).
 */
export const orderRepository: OrderStore = orderStore;

export type { OrderRecord };
