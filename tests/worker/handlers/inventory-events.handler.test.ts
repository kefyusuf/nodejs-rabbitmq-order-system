import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/shared/repositories/order.repository', () => ({
  orderRepository: { updateStatus: vi.fn() },
}));
vi.mock('../../../src/shared/messaging/publisher', () => ({
  publishMessage: vi.fn(),
}));

import { orderRepository } from '../../../src/shared/repositories/order.repository';
import { publishMessage } from '../../../src/shared/messaging/publisher';
import {
  handleInventoryFailed,
  handleInventoryReserved,
} from '../../../src/worker/handlers/inventory-events.handler';
import {
  InventoryReservedEvent,
  InventoryReservationFailedEvent,
} from '../../../src/shared/types/order';

const mockedUpdateStatus = vi.mocked(orderRepository.updateStatus);
const mockedPublish = vi.mocked(publishMessage);

const items = [
  { productId: 'prod-1', name: 'Keyboard', quantity: 1, unitPrice: 500 },
];

function reservedEvent(totalAmount: number): InventoryReservedEvent {
  return { orderId: 'order-1', customerName: 'Alice', totalAmount, items };
}
function failedEvent(): InventoryReservationFailedEvent {
  return { orderId: 'order-1', reason: 'out of stock', items };
}

describe('order worker (inventory saga)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockedUpdateStatus.mockResolvedValue({
      id: 'order-1',
      customerName: 'Alice',
      items: [],
      totalAmount: 100,
      status: 'CONFIRMED',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockedPublish.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('confirms orders within the limit and publishes order.confirmed', async () => {
    const pending = handleInventoryReserved(reservedEvent(5000));
    await vi.advanceTimersByTimeAsync(1500);
    await pending;

    expect(mockedUpdateStatus).toHaveBeenCalledWith('order-1', 'CONFIRMED');
    expect(mockedPublish).toHaveBeenCalledWith(
      'order.confirmed',
      expect.objectContaining({ orderId: 'order-1', status: 'CONFIRMED' }),
    );
  });

  it('fails orders above the limit, releases stock and publishes order.failed', async () => {
    const pending = handleInventoryReserved(reservedEvent(20000));
    await vi.advanceTimersByTimeAsync(1500);
    await pending;

    expect(mockedUpdateStatus).toHaveBeenCalledWith('order-1', 'FAILED');
    expect(mockedPublish).toHaveBeenCalledWith(
      'inventory.release',
      expect.objectContaining({ orderId: 'order-1', items }),
    );
    expect(mockedPublish).toHaveBeenCalledWith(
      'order.failed',
      expect.objectContaining({ orderId: 'order-1', status: 'FAILED' }),
    );
  });

  it('marks the order FAILED when reservation failed', async () => {
    const pending = handleInventoryFailed(failedEvent());
    await pending;

    expect(mockedUpdateStatus).toHaveBeenCalledWith('order-1', 'FAILED');
    expect(mockedPublish).toHaveBeenCalledWith(
      'order.failed',
      expect.objectContaining({ orderId: 'order-1', status: 'FAILED' }),
    );
  });

  it('propagates repository failures to the caller', async () => {
    mockedUpdateStatus.mockRejectedValue(new Error('db down'));

    const pending = handleInventoryReserved(reservedEvent(100));
    const expectation = expect(pending).rejects.toThrow('db down');
    await vi.advanceTimersByTimeAsync(1500);
    await expectation;
  });
});
