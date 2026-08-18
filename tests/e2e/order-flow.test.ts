import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { spawn, type ChildProcess, execSync } from 'node:child_process';

const ROOT = process.cwd();

let pg: StartedTestContainer;
let rabbit: StartedTestContainer;
const services: ChildProcess[] = [];
let notificationLog = '';
const env: NodeJS.ProcessEnv = {};
const API_PORT = '8080';
const API_URL = `http://localhost:${API_PORT}`;

function spawnService(file: string, captureNotification = false): ChildProcess {
  const child = spawn('npx', ['tsx', file], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  const sink = captureNotification
    ? (d: Buffer) => (notificationLog += d.toString())
    : () => {};
  child.stdout?.on('data', sink);
  child.stderr?.on('data', sink);
  services.push(child);
  return child;
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function getToken(): Promise<string> {
  const res = await fetch(`${API_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e' }),
  });
  return (await res.json()).token as string;
}

async function postOrder(token: string, items: unknown[]) {
  const res = await fetch(`${API_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ customerName: 'E2E', items }),
  });
  return { statusCode: res.status, body: (await res.json()) as { id: string; status: string } };
}

async function getOrder(token: string, id: string) {
  const res = await fetch(`${API_URL}/orders/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return (await res.json()) as { id: string; status: string };
}

async function getInventory(sku: string) {
  const res = await fetch(`${API_URL}/inventory/${sku}`);
  return (await res.json()) as { sku: string; available: number; reserved: number };
}

async function waitStatus(token: string, id: string, want: string) {
  await waitFor(
    async () => (await getOrder(token, id)).status === want,
    20000,
    `order ${id} -> ${want}`,
  );
  return getOrder(token, id);
}

beforeAll(async () => {
  pg = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: 'postgres',
      POSTGRES_DB: 'orders',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  rabbit = await new GenericContainer('rabbitmq:3-management')
    .withEnvironment({ RABBITMQ_DEFAULT_USER: 'guest', RABBITMQ_DEFAULT_PASS: 'guest' })
    .withExposedPorts(5672, 15672)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  env.DATABASE_URL = `postgresql://postgres:postgres@${pg.getHost()}:${pg.getMappedPort(5432)}/orders?schema=public`;
  env.RABBITMQ_URL = `amqp://guest:guest@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;
  env.RABBITMQ_EXCHANGE = 'orders';
  env.NODE_ENV = 'test';
  env.MAIL_MODE = 'console';
  env.JWT_SECRET = 'test-secret';
  env.PORT = API_PORT;
  process.env.DATABASE_URL = env.DATABASE_URL;

  execSync('npx prisma migrate deploy', {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });

  // Start the real services (same code as production) against the containers.
  spawnService('src/outbox-relay/index.ts');
  spawnService('src/inventory-worker/index.ts');
  spawnService('src/worker/index.ts');
  spawnService('src/notification-worker/index.ts', true);
  spawnService('src/api/index.ts');

  await waitFor(async () => (await fetch(`${API_URL}/health`)).ok, 30000, 'api health');
  await waitFor(async () => {
    const res = await fetch(`${API_URL}/inventory`);
    if (!res.ok) return false;
    return ((await res.json()) as unknown[]).length === 3;
  }, 30000, 'inventory seeded');
  // Let the remaining consumers finish binding their queues.
  await new Promise((r) => setTimeout(r, 2000));
}, 180000);

afterAll(async () => {
  services.forEach((p) => {
    try {
      p.kill('SIGTERM');
    } catch {
      // ignore
    }
  });
  await new Promise((r) => setTimeout(r, 1000));
  services.forEach((p) => {
    try {
      p.kill('SIGKILL');
    } catch {
      // ignore
    }
  });
  try {
    await pg.stop();
  } catch {
    // ignore
  }
  try {
    await rabbit.stop();
  } catch {
    // ignore
  }
}, 60000);

describe('end-to-end order saga (real Postgres + RabbitMQ)', () => {
  let token = '';

  beforeAll(async () => {
    token = await getToken();
  });

  it('confirms an order and reserves its stock', async () => {
    const created = await postOrder(token, [
      { productId: 'prod-3', name: 'Mouse', quantity: 1, unitPrice: 100 },
    ]);
    expect(created.statusCode).toBe(201);

    const order = await waitStatus(token, created.body.id, 'CONFIRMED');
    expect(order.status).toBe('CONFIRMED');

    const inv = await getInventory('prod-3');
    expect(inv.available).toBe(199);
    expect(inv.reserved).toBe(1);
  });

  it('releases stock when the business rule rejects an order', async () => {
    const created = await postOrder(token, [
      { productId: 'prod-2', name: 'Server', quantity: 1, unitPrice: 20000 },
    ]);

    const order = await waitStatus(token, created.body.id, 'FAILED');
    expect(order.status).toBe('FAILED');

    const inv = await getInventory('prod-2');
    expect(inv.reserved).toBe(0);
    expect(inv.available).toBe(10);
  });

  it('sends a customer notification email for a confirmed order', async () => {
    const created = await postOrder(token, [
      { productId: 'prod-3', name: 'Mouse', quantity: 1, unitPrice: 100 },
    ]);
    await waitStatus(token, created.body.id, 'CONFIRMED');

    await waitFor(
      async () => notificationLog.includes('confirmed'),
      10000,
      'notification email',
    );
    expect(notificationLog).toContain('confirmed');
  });
});
