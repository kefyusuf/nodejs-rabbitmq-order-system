import { FastifyInstance } from 'fastify';
import { createOrderSchema } from '../../shared/types/order';
import { orderRepository } from '../../shared/repositories/order.repository';
import { publishMessage } from '../../shared/messaging/publisher';
import { ROUTING_KEYS } from '../../shared/messaging/constants';

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.post('/orders', async (request, reply) => {
    const parsed = createOrderSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten(),
      });
    }

    const order = await orderRepository.create(parsed.data);

    await publishMessage(ROUTING_KEYS.ORDER_CREATED, {
      orderId: order.id,
      customerName: order.customerName,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt.toISOString(),
    });

    return reply.status(201).send(order);
  });

  app.get('/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await orderRepository.findById(id);

    if (!order) {
      return reply.status(404).send({ error: 'Order not found' });
    }

    return reply.send(order);
  });

  app.get('/orders', async (_request, reply) => {
    const orders = await orderRepository.findAll();
    return reply.send(orders);
  });
}
