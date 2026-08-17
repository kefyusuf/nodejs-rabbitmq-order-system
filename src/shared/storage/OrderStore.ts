import { CreateOrderInput, OrderItem, OrderStatus } from '../types/order';

/**
 * Storage bağımsızlığı için ortak arayüz.
 *
 * beginner  : InMemoryOrderStore       (tek süreç, hiçbir dış bağımlılık)
 * mid       : + RedisOrderStore        (ioredis)
 * hero      : + PostgresOrderStore     (@prisma/client)
 *
 * STORE env değeri hangi adapterin aktif olduğunu belirler.
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
