import { Prisma, type InventoryItem } from '../../generated/prisma/client';
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

export class UnknownSkuError extends Error {
  constructor(public readonly sku: string) {
    super(`Unknown SKU: ${sku}`);
    this.name = 'UnknownSkuError';
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
  return items.map((item) => ({
    sku: item.productId,
    quantity: item.quantity,
  }));
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
   * (FOR UPDATE) so concurrent orders can't oversell. Idempotent per `orderId`:
   * a retry after a partial failure is a no-op instead of a double reservation.
   * Throws InsufficientStockError (rolling back) if any line is unavailable.
   */
  async reserve(
    orderId: string,
    items: OrderItem[],
  ): Promise<'reserved' | 'already-reserved'> {
    const lines = toLines(items);
    return prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryReservation.findUnique({
        where: { orderId },
      });
      if (existing) {
        return 'already-reserved' as const;
      }

      // Lock rows in a stable (sorted) order to avoid deadlocks.
      const skus = [...new Set(lines.map((l) => l.sku))].sort();
      const locked = await tx.$queryRaw<
        Array<{ sku: string; available: number }>
      >(
        Prisma.sql`SELECT * FROM "inventory_items" WHERE "sku" = ANY(${skus}::text[]) FOR UPDATE`,
      );
      const bySku = new Map(locked.map((row) => [row.sku, row]));

      for (const line of lines) {
        const row = bySku.get(line.sku);
        if (!row) {
          throw new UnknownSkuError(line.sku);
        }
        if (row.available < line.quantity) {
          throw new InsufficientStockError(
            line.sku,
            line.quantity,
            row.available,
          );
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

      await tx.inventoryReservation.create({ data: { orderId } });
      return 'reserved' as const;
    });
  },

  /**
   * Release previously reserved stock (compensation when an order fails after
   * reservation). Only the currently reserved amount is returned, so a
   * duplicate/over-release cannot drive `reserved` negative or inflate stock.
   * Idempotent: releasing twice is a no-op once the reservation is gone.
   */
  async release(orderId: string, items: OrderItem[]): Promise<void> {
    const lines = toLines(items);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryReservation.findUnique({
        where: { orderId },
      });
      if (!existing) {
        return;
      }

      const skus = [...new Set(lines.map((l) => l.sku))].sort();
      const locked = await tx.$queryRaw<
        Array<{ sku: string; reserved: number }>
      >(
        Prisma.sql`SELECT "sku", "reserved" FROM "inventory_items" WHERE "sku" = ANY(${skus}::text[]) FOR UPDATE`,
      );
      const bySku = new Map(locked.map((row) => [row.sku, row.reserved]));

      for (const line of lines) {
        const currentlyReserved = bySku.get(line.sku) ?? 0;
        const releaseQty = Math.min(line.quantity, currentlyReserved);
        if (releaseQty <= 0) {
          continue;
        }
        await tx.inventoryItem.update({
          where: { sku: line.sku },
          data: {
            available: { increment: releaseQty },
            reserved: { decrement: releaseQty },
          },
        });
      }

      await tx.inventoryReservation.delete({ where: { orderId } });
    });
  },

  /** Read model: current stock levels for all products, ordered by SKU. */
  async list(): Promise<InventoryItem[]> {
    return prisma.inventoryItem.findMany({ orderBy: { sku: 'asc' } });
  },

  /** Read model: a single product's stock level, or null if unknown. */
  async getBySku(sku: string): Promise<InventoryItem | null> {
    return prisma.inventoryItem.findUnique({ where: { sku } });
  },
};
