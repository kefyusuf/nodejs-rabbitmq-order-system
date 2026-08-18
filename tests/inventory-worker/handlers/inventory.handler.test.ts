import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/shared/repositories/inventory.repository', () => ({
  inventoryRepository: {
    reserve: vi.fn(),
    release: vi.fn(),
  },
  InsufficientStockError: class extends Error {
    constructor(
      public sku: string,
      public requested: number,
      public available: number,
    ) {
      super('InsufficientStockError');
    }
  },
}));

vi.mock('../../../src/shared/messaging/publisher', () => ({
  publishMessage: vi.fn(),
}));

import { inventoryRepository, InsufficientStockError } from '../../../src/shared/repositories/inventory.repository';
import { publishMessage } from '../../../src/shared/messaging/publisher';
import {
  handleOrderCreated,
  handleRelease,
} from '../../../src/inventory-worker/handlers/inventory.handler';
import { OrderCreatedEvent, InventoryReleaseEvent } from '../../../src/shared/types/order';

const mockedReserve = vi.mocked(inventoryRepository.reserve);
const mockedRelease = vi.mocked(inventoryRepository.release);
const mockedPublish = vi.mocked(publishMessage);

const items = [
  { productId: 'prod-1', name: 'Keyboard', quantity: 2, unitPrice: 500 },
];

function orderCreated(): OrderCreatedEvent {
  return {
    orderId: 'order-1',
    customerName: 'Alice',
    totalAmount: 1000,
    items,
    createdAt: new Date().toISOString(),
  };
}

describe('inventory worker handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedReserve.mockResolvedValue(undefined);
    mockedRelease.mockResolvedValue(undefined);
    mockedPublish.mockResolvedValue(undefined);
  });

  it('reserves stock and publishes inventory.reserved', async () => {
    await handleOrderCreated(orderCreated());

    expect(mockedReserve).toHaveBeenCalledWith(items);
    expect(mockedPublish).toHaveBeenCalledWith(
      'inventory.reserved',
      expect.objectContaining({ orderId: 'order-1' }),
    );
  });

  it('publishes inventory.reservation.failed when stock is insufficient', async () => {
    mockedReserve.mockRejectedValue(
      new InsufficientStockError('prod-1', 2, 0),
    );

    await handleOrderCreated(orderCreated());

    expect(mockedPublish).toHaveBeenCalledWith(
      'inventory.reservation.failed',
      expect.objectContaining({ orderId: 'order-1', reason: expect.any(String) }),
    );
  });

  it('releases stock on a release event', async () => {
    const event: InventoryReleaseEvent = { orderId: 'order-1', items };
    await handleRelease(event);

    expect(mockedRelease).toHaveBeenCalledWith(items);
  });
});
