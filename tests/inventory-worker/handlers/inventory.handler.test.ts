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
  UnknownSkuError: class extends Error {
    constructor(public sku: string) {
      super(`Unknown SKU: ${sku}`);
    }
  },
}));

vi.mock('../../../src/shared/messaging/publisher', () => ({
  publishMessage: vi.fn(),
}));

import {
  inventoryRepository,
  InsufficientStockError,
  UnknownSkuError,
} from '../../../src/shared/repositories/inventory.repository';
import { publishMessage } from '../../../src/shared/messaging/publisher';
import {
  handleOrderCreated,
  handleRelease,
} from '../../../src/inventory-worker/handlers/inventory.handler';
import {
  OrderCreatedEvent,
  InventoryReleaseEvent,
} from '../../../src/shared/types/order';

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
    mockedReserve.mockResolvedValue('reserved');
    mockedRelease.mockResolvedValue(undefined);
    mockedPublish.mockResolvedValue(undefined);
  });

  it('reserves stock and publishes inventory.reserved', async () => {
    await handleOrderCreated(orderCreated());

    expect(mockedReserve).toHaveBeenCalledWith('order-1', items);
    expect(mockedPublish).toHaveBeenCalledWith(
      'inventory.reserved',
      expect.objectContaining({ orderId: 'order-1' }),
      'inventory.reserved:order-1',
    );
  });

  it('publishes inventory.reservation.failed when stock is insufficient', async () => {
    mockedReserve.mockRejectedValue(new InsufficientStockError('prod-1', 2, 0));

    await handleOrderCreated(orderCreated());

    expect(mockedPublish).toHaveBeenCalledWith(
      'inventory.reservation.failed',
      expect.objectContaining({
        orderId: 'order-1',
        reason: expect.any(String),
      }),
      'inventory.reservation.failed:order-1',
    );
  });

  it('publishes inventory.reservation.failed for unknown SKUs', async () => {
    mockedReserve.mockRejectedValue(new UnknownSkuError('prod-unknown'));

    await handleOrderCreated(orderCreated());

    expect(mockedPublish).toHaveBeenCalledWith(
      'inventory.reservation.failed',
      expect.objectContaining({
        orderId: 'order-1',
        reason: expect.stringContaining('prod-unknown'),
      }),
      'inventory.reservation.failed:order-1',
    );
  });

  it('rethrows transient failures so the consumer can retry', async () => {
    mockedReserve.mockRejectedValue(new Error('db down'));

    await expect(handleOrderCreated(orderCreated())).rejects.toThrow('db down');
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('releases stock on a release event', async () => {
    const event: InventoryReleaseEvent = { orderId: 'order-1', items };
    await handleRelease(event);

    expect(mockedRelease).toHaveBeenCalledWith('order-1', items);
  });
});
