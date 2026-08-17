import { Prisma } from '@prisma/client';
import { OrderStatus as PrismaOrderStatus } from '@prisma/client';
import { calculateOrderTotal } from '../domain/order';
import { prisma } from '../db/prisma';
import { ROUTING_KEYS } from '../messaging/constants';
import { CreateOrderInput, OrderStatus } from '../types/order';
import { OrderRecord, OrderStore } from './OrderStore';

/**
 * Hero seviyesi — PostgreSQL (Prisma) kalıcılık.
 * Order, aynı transaction içinde Outbox kaydıyla yazılır (transactional
 * outbox); ayrı bir relay servisi event'i RabbitMQ'ya yayınlar.
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
          aggregateType: 'order',
          aggregateId: created.id,
          type: ROUTING_KEYS.ORDER_CREATED,
          payload: {
            orderId: created.id,
            customerName: created.customerName,
            totalAmount: Number(created.totalAmount),
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
