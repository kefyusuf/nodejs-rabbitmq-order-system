import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/shared/repositories/order.repository', () => ({
  orderRepository: {
    updateStatus: vi.fn(),
  },
}));

vi.mock('../../../src/shared/messaging/publisher', () => ({
  publishMessage: vi.fn(),
}));

import { orderRepository } from '../../../src/shared/repositories/order.repository';
import { publishMessage } from '../../../src/shared/messaging/publisher';
import { handleOrderCreated } from '../../../src/worker/handlers/order-created.handler';
import { OrderCreatedEvent } from '../../../src/shared/types/order';

const mockedUpdateStatus = vi.mocked(orderRepository.updateStatus);
const mockedPublish = vi.mocked(publishMessage);

function buildEvent(totalAmount: number): OrderCreatedEvent {
  return {
    orderId: 'order-1',
    customerName: 'Alice',
    totalAmount,
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  };
}

describe('handleOrderCreated', () => {
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
    const pending = handleOrderCreated(buildEvent(5000));
    await vi.advanceTimersByTimeAsync(1500);
    await pending;

    expect(mockedUpdateStatus).toHaveBeenCalledWith('order-1', 'CONFIRMED');
    expect(mockedPublish).toHaveBeenCalledWith(
      'order.confirmed',
      expect.objectContaining({ orderId: 'order-1', status: 'CONFIRMED' }),
    );
  });

  it('fails orders above the limit and publishes order.failed', async () => {
    const pending = handleOrderCreated(buildEvent(20000));
    await vi.advanceTimersByTimeAsync(1500);
    await pending;

    expect(mockedUpdateStatus).toHaveBeenCalledWith('order-1', 'FAILED');
    expect(mockedPublish).toHaveBeenCalledWith(
      'order.failed',
      expect.objectContaining({ orderId: 'order-1', status: 'FAILED' }),
    );
  });

  it('propagates repository failures to the caller', async () => {
    mockedUpdateStatus.mockRejectedValue(new Error('db down'));

    const pending = handleOrderCreated(buildEvent(100));
    // Attach the handler before the rejection fires so it never looks
    // unhandled to the runner.
    const expectation = expect(pending).rejects.toThrow('db down');
    await vi.advanceTimersByTimeAsync(1500);
    await expectation;
  });
});
