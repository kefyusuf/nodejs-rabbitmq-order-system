import { FastifyInstance } from 'fastify';
import { inventoryRepository } from '../../shared/repositories/inventory.repository';
import { inventoryItemsReadTotal } from '../../shared/observability/metrics';

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  // Read model: current stock levels. Public, like GET /orders.
  app.get('/inventory', async (_request, reply) => {
    const items = await inventoryRepository.list();
    inventoryItemsReadTotal.inc();
    return reply.send(items);
  });

  app.get('/inventory/:sku', async (request, reply) => {
    const { sku } = request.params as { sku: string };
    const item = await inventoryRepository.getBySku(sku);

    if (!item) {
      return reply.status(404).send({ error: 'Inventory item not found' });
    }

    inventoryItemsReadTotal.inc();
    return reply.send(item);
  });
}
