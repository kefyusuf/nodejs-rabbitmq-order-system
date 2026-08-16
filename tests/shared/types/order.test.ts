import { describe, expect, it } from 'vitest';
import { createOrderSchema } from '../../../src/shared/types/order';

const validItem = {
  productId: 'p-1',
  name: 'Keyboard',
  quantity: 1,
  unitPrice: 2500,
};

describe('createOrderSchema', () => {
  it('accepts a valid order payload', () => {
    const result = createOrderSchema.safeParse({
      customerName: 'Alice',
      items: [validItem],
    });

    expect(result.success).toBe(true);
  });

  it('rejects an empty customer name', () => {
    const result = createOrderSchema.safeParse({
      customerName: '',
      items: [validItem],
    });

    expect(result.success).toBe(false);
  });

  it('rejects an order without items', () => {
    const result = createOrderSchema.safeParse({
      customerName: 'Alice',
      items: [],
    });

    expect(result.success).toBe(false);
  });

  it('rejects negative or zero prices and quantities', () => {
    for (const override of [
      { quantity: 0 },
      { quantity: -1 },
      { quantity: 1.5 },
      { unitPrice: 0 },
      { unitPrice: -10 },
    ]) {
      const result = createOrderSchema.safeParse({
        customerName: 'Alice',
        items: [{ ...validItem, ...override }],
      });

      expect(result.success).toBe(false);
    }
  });

  it('rejects items with blank product ids or names', () => {
    for (const override of [{ productId: '' }, { name: '' }]) {
      const result = createOrderSchema.safeParse({
        customerName: 'Alice',
        items: [{ ...validItem, ...override }],
      });

      expect(result.success).toBe(false);
    }
  });
});
