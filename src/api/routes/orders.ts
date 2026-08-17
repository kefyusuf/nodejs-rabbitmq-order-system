import { FastifyInstance } from 'fastify';
import { createOrderSchema } from '../../shared/types/order';
import { orderRepository } from '../../shared/repositories/order.repository';
import { ordersCreatedTotal } from '../../shared/observability/metrics';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('order-api');

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.post('/orders', { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = createOrderSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten(),
      });
    }

    const order = await tracer.startActiveSpan('createOrder', async (span) => {
      try {
        const created = await orderRepository.create(parsed.data);
        span.setAttribute('order.id', created.id);
        return created;
      } finally {
        span.end();
      }
    });

    ordersCreatedTotal.inc();

    // The event is persisted in the outbox (transactional outbox pattern);
    // a separate relay service publishes it to RabbitMQ. The order stays
    // PENDING until the worker processes it.
    return reply.status(201).send({ ...order, eventStored: true });
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
