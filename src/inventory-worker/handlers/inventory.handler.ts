import { publishMessage } from '../../shared/messaging/publisher';
import { ROUTING_KEYS } from '../../shared/messaging/constants';
import { inventoryRepository, InsufficientStockError } from '../../shared/repositories/inventory.repository';
import {
  InventoryReleaseEvent,
  InventoryReservationFailedEvent,
  InventoryReservedEvent,
  OrderCreatedEvent,
} from '../../shared/types/order';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('inventory-worker');

/**
 * Reserve stock for a newly created order. On success publishes
 * `inventory.reserved`; on insufficient stock publishes
 * `inventory.reservation.failed` so the order can be marked FAILED.
 */
export async function handleOrderCreated(
  event: OrderCreatedEvent,
): Promise<void> {
  await tracer.startActiveSpan('reserveStock', async (span) => {
    span.setAttribute('order.id', event.orderId);
    try {
      await inventoryRepository.reserve(event.items);

      const reserved: InventoryReservedEvent = {
        orderId: event.orderId,
        customerName: event.customerName,
        totalAmount: event.totalAmount,
        items: event.items,
      };
      await publishMessage(ROUTING_KEYS.INVENTORY_RESERVED, reserved);
      console.log(`Reserved stock for order ${event.orderId}`);
    } catch (error) {
      const reason =
        error instanceof InsufficientStockError
          ? error.message
          : 'stock reservation failed';
      const failed: InventoryReservationFailedEvent = {
        orderId: event.orderId,
        reason,
        items: event.items,
      };
      await publishMessage(ROUTING_KEYS.INVENTORY_RESERVATION_FAILED, failed);
      console.warn(
        `Stock reservation failed for order ${event.orderId}: ${reason}`,
      );
    } finally {
      span.end();
    }
  });
}

/** Release previously reserved stock (compensation). */
export async function handleRelease(event: InventoryReleaseEvent): Promise<void> {
  await inventoryRepository.release(event.items);
  console.log(`Released stock for order ${event.orderId}`);
}
