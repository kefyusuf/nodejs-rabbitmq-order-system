import {
  OrderCreatedEvent,
  OrderProcessedEvent,
} from '../../shared/types/order';
import { resolveOrderStatus } from '../../shared/domain/order';
import { orderRepository } from '../../shared/repositories/order.repository';
import { publishMessage } from '../../shared/messaging/publisher';
import { ROUTING_KEYS } from '../../shared/messaging/constants';

const PROCESSING_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleOrderCreated(
  event: OrderCreatedEvent,
): Promise<void> {
  console.log(`Processing order ${event.orderId} for ${event.customerName}`);

  await sleep(PROCESSING_DELAY_MS);

  const status = resolveOrderStatus(event.totalAmount);

  await orderRepository.updateStatus(event.orderId, status);

  const processedEvent: OrderProcessedEvent = {
    orderId: event.orderId,
    status,
    processedAt: new Date().toISOString(),
  };

  const routingKey =
    status === 'CONFIRMED'
      ? ROUTING_KEYS.ORDER_CONFIRMED
      : ROUTING_KEYS.ORDER_FAILED;

  await publishMessage(routingKey, processedEvent);

  console.log(`Order ${event.orderId} processed with status: ${status}`);
}
