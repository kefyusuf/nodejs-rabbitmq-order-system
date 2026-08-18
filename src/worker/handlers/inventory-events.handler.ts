import {
  InventoryReservedEvent,
  InventoryReservationFailedEvent,
  OrderProcessedEvent,
} from '../../shared/types/order';
import { resolveOrderStatus } from '../../shared/domain/order';
import { orderRepository } from '../../shared/repositories/order.repository';
import { publishMessage } from '../../shared/messaging/publisher';
import { ROUTING_KEYS } from '../../shared/messaging/constants';
import { trace } from '@opentelemetry/api';

const PROCESSING_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const tracer = trace.getTracer('order-worker');

/**
 * Stock was reserved successfully. Apply the business rule (total amount cap);
 * on success confirm the order, on rejection release the reserved stock and
 * fail the order (compensation).
 */
export async function handleInventoryReserved(
  event: InventoryReservedEvent,
): Promise<void> {
  await tracer.startActiveSpan('handleInventoryReserved', async (span) => {
    span.setAttribute('order.id', event.orderId);
    try {
      console.log(`Processing order ${event.orderId} for ${event.customerName}`);

      await sleep(PROCESSING_DELAY_MS);

      const status = resolveOrderStatus(event.totalAmount);
      await orderRepository.updateStatus(event.orderId, status);

      const processedEvent: OrderProcessedEvent = {
        orderId: event.orderId,
        status,
        processedAt: new Date().toISOString(),
      };

      if (status === 'CONFIRMED') {
        await publishMessage(ROUTING_KEYS.ORDER_CONFIRMED, processedEvent);
      } else {
        // Business rule rejected the order after stock was reserved: release it.
        await publishMessage(ROUTING_KEYS.INVENTORY_RELEASE, {
          orderId: event.orderId,
          items: event.items,
        });
        await publishMessage(ROUTING_KEYS.ORDER_FAILED, processedEvent);
      }

      console.log(`Order ${event.orderId} processed with status: ${status}`);
    } finally {
      span.end();
    }
  });
}

/** Stock reservation failed (e.g. out of stock) — mark the order FAILED. */
export async function handleInventoryFailed(
  event: InventoryReservationFailedEvent,
): Promise<void> {
  await tracer.startActiveSpan('handleInventoryFailed', async (span) => {
    span.setAttribute('order.id', event.orderId);
    try {
      console.log(`Order ${event.orderId} failed reservation: ${event.reason}`);

      await orderRepository.updateStatus(event.orderId, 'FAILED');

      const processedEvent: OrderProcessedEvent = {
        orderId: event.orderId,
        status: 'FAILED',
        processedAt: new Date().toISOString(),
      };
      await publishMessage(ROUTING_KEYS.ORDER_FAILED, processedEvent);
    } finally {
      span.end();
    }
  });
}
