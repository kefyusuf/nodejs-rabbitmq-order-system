import { describe, expect, it } from 'vitest';
import {
  calculateOrderTotal,
  MAX_ORDER_AMOUNT,
  resolveOrderStatus,
} from '../../../src/shared/domain/order';

describe('calculateOrderTotal', () => {
  it('sums quantity times unit price over all items', () => {
    const total = calculateOrderTotal([
      { productId: 'p-1', name: 'Keyboard', quantity: 1, unitPrice: 2500 },
      { productId: 'p-2', name: 'Cable', quantity: 2, unitPrice: 150 },
    ]);

    expect(total).toBe(2800);
  });

  it('returns 0 for an empty item list', () => {
    expect(calculateOrderTotal([])).toBe(0);
  });

  it('rounds totals to cent precision', () => {
    const total = calculateOrderTotal([
      { productId: 'p-1', name: 'Cable', quantity: 3, unitPrice: 0.1 },
      { productId: 'p-2', name: 'Clip', quantity: 1, unitPrice: 0.01 },
    ]);

    expect(total).toBe(0.31);
  });
});

describe('resolveOrderStatus', () => {
  it('confirms orders at or below the maximum amount', () => {
    expect(resolveOrderStatus(MAX_ORDER_AMOUNT)).toBe('CONFIRMED');
    expect(resolveOrderStatus(0)).toBe('CONFIRMED');
  });

  it('fails orders above the maximum amount', () => {
    expect(resolveOrderStatus(MAX_ORDER_AMOUNT + 0.01)).toBe('FAILED');
  });
});
