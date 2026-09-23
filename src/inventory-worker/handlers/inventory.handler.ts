import { publishMessage } from '../../shared/messaging/publisher';
import { ROUTING_KEYS } from '../../shared/messaging/constants';
import {
  inventoryRepository,
  InsufficientStockError,
  UnknownSkuError,
} from '../../shared/repositories/inventory.repository';
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
 * `inventory.reserved`; on insufficient stock (or unknown SKU) publishes
 * `inventory.reservation.failed` so the order can be marked FAILED.
 * Transient infrastructure errors are rethrown so the consumer can retry.
 */
export async function handleOrderCreated(
  event: OrderCreatedEvent,
): Promise<void> {
  await tracer.startActiveSpan('reserveStock', async (span) => {
    span.setAttribute('order.id', event.orderId);
    try {
      await inventoryRepository.reserve(event.orderId, event.items);

      const reserved: InventoryReservedEvent = {
        orderId: event.orderId,
        customerName: event.customerName,
        totalAmount: event.totalAmount,
        items: event.items,
      };
      // Stable id so a retried publish is deduped downstream.
      await publishMessage(
        ROUTING_KEYS.INVENTORY_RESERVED,
        reserved,
        `inventory.reserved:${event.orderId}`,
      );
      console.log(`Reserved stock for order ${event.orderId}`);
    } catch (error) {
      const isBusinessFailure =
        error instanceof InsufficientStockError ||
        error instanceof UnknownSkuError;

      if (!isBusinessFailure) {
        // DB / broker trouble must not permanently fail the order.
        throw error;
      }

      const reason = error.message;
      const failed: InventoryReservationFailedEvent = {
        orderId: event.orderId,
        reason,
        items: event.items,
      };
      await publishMessage(
        ROUTING_KEYS.INVENTORY_RESERVATION_FAILED,
        failed,
        `inventory.reservation.failed:${event.orderId}`,
      );
      console.warn(
        `Stock reservation failed for order ${event.orderId}: ${reason}`,
      );
    } finally {
      span.end();
    }
  });
}

/** Release previously reserved stock (compensation). */
export async function handleRelease(
  event: InventoryReleaseEvent,
): Promise<void> {
  await inventoryRepository.release(event.orderId, event.items);
  console.log(`Released stock for order ${event.orderId}`);
}
