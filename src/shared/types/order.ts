import { z } from 'zod';

export const orderItemSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
});

export const createOrderSchema = z.object({
  customerName: z.string().min(1).max(255),
  items: z.array(orderItemSchema).min(1),
});

export type OrderItem = z.infer<typeof orderItemSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'FAILED';

export interface OrderCreatedEvent {
  orderId: string;
  customerName: string;
  totalAmount: number;
  createdAt: string;
}

export interface OrderProcessedEvent {
  orderId: string;
  status: 'CONFIRMED' | 'FAILED';
  processedAt: string;
}
