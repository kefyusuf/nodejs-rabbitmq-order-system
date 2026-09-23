import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/shared/repositories/order.repository', () => ({
  orderRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
  },
}));

import { buildApp } from '../../../src/api/app';
import { orderRepository } from '../../../src/shared/repositories/order.repository';
import { OrderRecord } from '../../../src/shared/repositories/order.repository';

const mockedCreate = vi.mocked(orderRepository.create);
const mockedFindById = vi.mocked(orderRepository.findById);
const mockedFindAll = vi.mocked(orderRepository.findAll);

function buildOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: 'order-1',
    customerName: 'Alice',
    items: [],
    totalAmount: 500,
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const validBody = {
  customerName: 'Alice',
  items: [{ productId: 'p-1', name: 'Keyboard', quantity: 1, unitPrice: 500 }],
};

async function getToken(
  app: Awaited<ReturnType<typeof buildApp>>,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/token',
    payload: { username: 'tester' },
  });
  return (res.json() as { token: string }).token;
}

describe('order routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /orders returns 400 for invalid payloads', async () => {
    const app = await buildApp({ logger: false });
    const token = await getToken(app);

    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${token}` },
      payload: { customerName: '', items: [] },
    });

    expect(response.statusCode).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST /orders persists the order and stores the event in the outbox', async () => {
    const app = await buildApp({ logger: false });
    const token = await getToken(app);
    mockedCreate.mockResolvedValue(buildOrder());

    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: `Bearer ${token}` },
      payload: validBody,
    });

    expect(response.statusCode).toBe(201);
    expect(mockedCreate).toHaveBeenCalledWith({
      customerName: 'Alice',
      items: validBody.items,
    });
    expect(response.json().eventStored).toBe(true);
    await app.close();
  });

  it('POST /orders returns 401 without a token', async () => {
    const app = await buildApp({ logger: false });
    mockedCreate.mockResolvedValue(buildOrder());

    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: validBody,
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('GET /orders/:id returns 401 without a token', async () => {
    const app = await buildApp({ logger: false });

    const response = await app.inject({ method: 'GET', url: '/orders/nope' });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('GET /orders/:id returns 404 for unknown ids', async () => {
    const app = await buildApp({ logger: false });
    const token = await getToken(app);
    mockedFindById.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/orders/nope',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('GET /orders/:id returns the order when it exists', async () => {
    const app = await buildApp({ logger: false });
    const token = await getToken(app);
    mockedFindById.mockResolvedValue(
      buildOrder({ status: 'CONFIRMED', id: 'known' }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/orders/known',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('CONFIRMED');
    await app.close();
  });

  it('GET /orders lists all orders', async () => {
    const app = await buildApp({ logger: false });
    const token = await getToken(app);
    mockedFindAll.mockResolvedValue([
      buildOrder(),
      buildOrder({ id: 'order-2', customerName: 'Bob' }),
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/orders',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(2);
    await app.close();
  });

  it('GET /orders returns 401 without a token', async () => {
    const app = await buildApp({ logger: false });

    const response = await app.inject({ method: 'GET', url: '/orders' });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
