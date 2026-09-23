import { CreateOrderInput, OrderItem, OrderStatus } from '../types/order';

/**
 * Storage-agnostic order persistence contract.
 *
 * beginner  : InMemoryOrderStore       (single process, no external deps)
 * mid       : + RedisOrderStore        (ioredis)
 * hero      : + PostgresOrderStore     (@prisma/client)
 *
 * The `STORE` env value selects the active adapter.
 */
export interface OrderRecord {
  id: string;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderStore {
  create(input: CreateOrderInput): Promise<OrderRecord>;
  findById(id: string): Promise<OrderRecord | null>;
  findAll(): Promise<OrderRecord[]>;
  updateStatus(id: string, status: OrderStatus): Promise<OrderRecord>;
}
