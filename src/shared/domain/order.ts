import { OrderItem } from '../types/order';

/**
 * Orders above this amount are rejected by the processing worker
 * (simulated fraud/limit check for the demo domain).
 */
export const MAX_ORDER_AMOUNT = 10_000;

export function calculateOrderTotal(items: OrderItem[]): number {
  const total = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
  // Keep money at cent precision; JS floats drift on repeated arithmetic.
  return Math.round(total * 100) / 100;
}

export function resolveOrderStatus(
  totalAmount: number,
): 'CONFIRMED' | 'FAILED' {
  return totalAmount > MAX_ORDER_AMOUNT ? 'FAILED' : 'CONFIRMED';
}
