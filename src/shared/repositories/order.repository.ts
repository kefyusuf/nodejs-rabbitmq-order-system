import { Prisma, OrderStatus as PrismaOrderStatus } from '@prisma/client';
import { calculateOrderTotal } from '../domain/order';
import { prisma } from '../db/prisma';
import { CreateOrderInput, OrderStatus } from '../types/order';

export interface OrderRecord {
  id: string;
  customerName: string;
  items: unknown;
  totalAmount: number;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

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
    items: order.items,
    totalAmount: Number(order.totalAmount),
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export class OrderRepository {
  async create(input: CreateOrderInput): Promise<OrderRecord> {
    const totalAmount = calculateOrderTotal(input.items);

    const order = await prisma.order.create({
      data: {
        customerName: input.customerName,
        items: input.items,
        totalAmount,
        status: 'PENDING',
      },
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

export const orderRepository = new OrderRepository();
