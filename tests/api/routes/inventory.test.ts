import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/shared/repositories/inventory.repository', () => ({
  inventoryRepository: {
    list: vi.fn(),
    getBySku: vi.fn(),
  },
}));

import { buildApp } from '../../../src/api/app';
import { inventoryRepository } from '../../../src/shared/repositories/inventory.repository';

const mockedList = vi.mocked(inventoryRepository.list);
const mockedGetBySku = vi.mocked(inventoryRepository.getBySku);

function buildItem(sku: string, available: number, reserved: number) {
  return {
    id: `id-${sku}`,
    sku,
    name: sku,
    available,
    reserved,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('inventory routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /inventory returns all items', async () => {
    const app = await buildApp({ logger: false });
    mockedList.mockResolvedValue([
      buildItem('prod-1', 98, 2),
      buildItem('prod-2', 10, 0),
    ]);

    const response = await app.inject({ method: 'GET', url: '/inventory' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(2);
    expect(mockedList).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('GET /inventory/:sku returns 404 for unknown skus', async () => {
    const app = await buildApp({ logger: false });
    mockedGetBySku.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/inventory/nope',
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('GET /inventory/:sku returns the item when it exists', async () => {
    const app = await buildApp({ logger: false });
    mockedGetBySku.mockResolvedValue(buildItem('prod-1', 98, 2));

    const response = await app.inject({
      method: 'GET',
      url: '/inventory/prod-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().available).toBe(98);
    expect(mockedGetBySku).toHaveBeenCalledWith('prod-1');
    await app.close();
  });
});
