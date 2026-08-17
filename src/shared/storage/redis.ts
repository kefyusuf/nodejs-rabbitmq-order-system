import IORedis from 'ioredis';
import { calculateOrderTotal } from '../domain/order';
import { CreateOrderInput, OrderStatus } from '../types/order';
import { OrderRecord, OrderStore } from './OrderStore';

const INDEX_KEY = 'orders:index';
const ORDER_KEY = (id: string) => `order:${id}`;

function serialize(order: OrderRecord): string {
  return JSON.stringify(order);
}

function deserialize(raw: string | null): OrderRecord | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Omit<
    OrderRecord,
    'createdAt' | 'updatedAt'
  > & {
    createdAt: string;
    updatedAt: string;
  };
  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
    updatedAt: new Date(parsed.updatedAt),
  };
}

/**
 * mid seviyesi — Redis (ioredis) kalıcılık.
 * Tek süreçli değil: api ve worker ayrı proseslerde olabilir,
 * çünkü durum paylaşık bir dış veri kaynağındadır.
 */
export class RedisOrderStore implements OrderStore {
  private readonly client: IORedis;

  constructor(url: string) {
    this.client = new IORedis(url);
  }

  async create(input: CreateOrderInput): Promise<OrderRecord> {
    const now = new Date();
    const order: OrderRecord = {
      id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 8),
      customerName: input.customerName,
      items: input.items,
      totalAmount: calculateOrderTotal(input.items),
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    };
    const pipe = this.client.multi();
    pipe.set(ORDER_KEY(order.id), serialize(order));
    pipe.zadd(INDEX_KEY, now.getTime(), order.id);
    await pipe.exec();
    return order;
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const raw = await this.client.get(ORDER_KEY(id));
    return deserialize(raw);
  }

  async findAll(): Promise<OrderRecord[]> {
    const ids = await this.client.zrevrange(INDEX_KEY, 0, -1);
    if (ids.length === 0) return [];
    const raws = await this.client.mget(...ids.map(ORDER_KEY));
    return raws
      .map((raw): OrderRecord | null =>
        raw !== null ? deserialize(raw) : null,
      )
      .filter((o): o is OrderRecord => o !== null);
  }

  async updateStatus(id: string, status: OrderStatus): Promise<OrderRecord> {
    const key = ORDER_KEY(id);
    const raw = await this.client.get(key);
    const order = deserialize(raw);
    if (!order) {
      throw new Error(`Order not found: ${id}`);
    }
    order.status = status;
    order.updatedAt = new Date();
    await this.client.set(key, serialize(order));
    return order;
  }
}
