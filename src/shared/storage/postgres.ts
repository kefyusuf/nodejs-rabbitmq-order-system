import {
  Prisma,
  OrderStatus as PrismaOrderStatus,
} from '../../generated/prisma/client';
import { calculateOrderTotal } from '../domain/order';
import { prisma } from '../db/prisma';
import { ROUTING_KEYS } from '../messaging/constants';
import { CreateOrderInput, OrderStatus } from '../types/order';
import { OrderRecord, OrderStore } from './OrderStore';

/**
 * Hero-tier persistence on PostgreSQL (Prisma).
 * The order and its outbox row are written in one transaction (transactional
 * outbox); a separate relay service publishes the event to RabbitMQ.
 */
function mapOrder(order: {
  id: string;
  customerName: string;
  items: Prisma.JsonValue;
  totalAmount: Prisma.Decimal;
  status: PrismaOrderStatus;
  createdAt: Date;
  updatedAt: Date;
}): OrderRecord {
  return {
    id: order.id,
    customerName: order.customerName,
    items: order.items as OrderRecord['items'],
    totalAmount: Number(order.totalAmount),
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export class PostgresOrderStore implements OrderStore {
  async create(input: CreateOrderInput): Promise<OrderRecord> {
    const totalAmount = calculateOrderTotal(input.items);

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          customerName: input.customerName,
          items: input.items,
          totalAmount,
          status: 'PENDING',
        },
      });

      await tx.outbox.create({
        data: {
          // Deterministic message id: outbox redeliveries dedupe downstream.
          id: `order.created:${created.id}`,
          aggregateType: 'order',
          aggregateId: created.id,
          type: ROUTING_KEYS.ORDER_CREATED,
          payload: {
            orderId: created.id,
            customerName: created.customerName,
            totalAmount: Number(created.totalAmount),
            items: input.items,
            createdAt: created.createdAt.toISOString(),
          },
        },
      });

      return created;
    });

    return mapOrder(order);
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const order = await prisma.order.findUnique({ where: { id } });
    return order ? mapOrder(order) : null;
  }

  async findAll(): Promise<OrderRecord[]> {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return orders.map(mapOrder);
  }

  async updateStatus(id: string, status: OrderStatus): Promise<OrderRecord> {
    const order = await prisma.order.update({
      where: { id },
      data: { status },
    });
    return mapOrder(order);
  }
}
