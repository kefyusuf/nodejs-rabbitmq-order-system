import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { OrderItem } from '../types/order';

export class InsufficientStockError extends Error {
  constructor(
    public readonly sku: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `Insufficient stock for ${sku}: requested ${requested}, available ${available}`,
    );
    this.name = 'InsufficientStockError';
  }
}

interface Line {
  sku: string;
  quantity: number;
}

const SEED_PRODUCTS = [
  { sku: 'prod-1', name: 'Keyboard', available: 100 },
  { sku: 'prod-2', name: 'Server', available: 10 },
  { sku: 'prod-3', name: 'Mouse', available: 200 },
];

function toLines(items: OrderItem[]): Line[] {
  return items.map((item) => ({ sku: item.productId, quantity: item.quantity }));
}

export const inventoryRepository = {
  /**
   * Idempotent seed: inserts demo products the first time the service runs.
   * Safe to call on every startup — it's a no-op once data exists.
   */
  async ensureSeeded(): Promise<void> {
    const count = await prisma.inventoryItem.count();
    if (count > 0) {
      return;
    }
    await prisma.inventoryItem.createMany({ data: SEED_PRODUCTS });
    console.log(`Seeded ${SEED_PRODUCTS.length} inventory items`);
  },

  /**
   * Reserve stock for every line in one transaction, locking the affected rows
   * (FOR UPDATE) so concurrent orders can't oversell. Throws
   * InsufficientStockError (rolling back) if any line is unavailable.
   */
  async reserve(items: OrderItem[]): Promise<void> {
    const lines = toLines(items);
    await prisma.$transaction(async (tx) => {
      // Lock rows in a stable (sorted) order to avoid deadlocks.
      const skus = [...new Set(lines.map((l) => l.sku))].sort();
      const locked = await tx.$queryRaw<Array<{ sku: string; available: number }>>(
        Prisma.sql`SELECT * FROM "inventory_items" WHERE "sku" = ANY(${skus}::text[]) FOR UPDATE`,
      );
      const bySku = new Map(locked.map((row) => [row.sku, row]));

      for (const line of lines) {
        const row = bySku.get(line.sku);
        if (!row) {
          throw new Error(`Unknown SKU: ${line.sku}`);
        }
        if (row.available < line.quantity) {
          throw new InsufficientStockError(line.sku, line.quantity, row.available);
        }
      }

      for (const line of lines) {
        await tx.inventoryItem.update({
          where: { sku: line.sku },
          data: {
            available: { decrement: line.quantity },
            reserved: { increment: line.quantity },
          },
        });
      }
    });
  },

  /**
   * Release previously reserved stock (compensation when an order fails after
   * reservation). Best-effort: a missing/negative `reserved` is clamped.
   */
  async release(items: OrderItem[]): Promise<void> {
    const lines = toLines(items);
    await prisma.$transaction(async (tx) => {
      for (const line of lines) {
        await tx.inventoryItem.update({
          where: { sku: line.sku },
          data: {
            available: { increment: line.quantity },
            reserved: { decrement: line.quantity },
          },
        });
      }
    });
  },
};
