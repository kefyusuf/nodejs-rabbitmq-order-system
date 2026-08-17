import { randomUUID } from 'node:crypto';
import { calculateOrderTotal } from '../domain/order';
import { CreateOrderInput, OrderStatus } from '../types/order';
import { OrderRecord, OrderStore } from './OrderStore';

/**
 * Tek süreçli (beginner) ve test ortamı için hafif bir mağaza.
 * Başka bir processten erişilemez — beginner tier'da api + worker aynı
 * node sürecinde çalışır ki bu bellek paylaşılabilsin.
 */
export class InMemoryOrderStore implements OrderStore {
  private readonly orders = new Map<string, OrderRecord>();

  async create(input: CreateOrderInput): Promise<OrderRecord> {
    const now = new Date();
    const order: OrderRecord = {
      id: randomUUID(),
      customerName: input.customerName,
      items: input.items,
      totalAmount: calculateOrderTotal(input.items),
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(order.id, order);
    return order;
  }

  async findById(id: string): Promise<OrderRecord | null> {
    return this.orders.get(id) ?? null;
  }

  async findAll(): Promise<OrderRecord[]> {
    return Array.from(this.orders.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async updateStatus(id: string, status: OrderStatus): Promise<OrderRecord> {
    const order = this.orders.get(id);
    if (!order) {
      throw new Error(`Order not found: ${id}`);
    }
    order.status = status;
    order.updatedAt = new Date();
    return order;
  }
}
