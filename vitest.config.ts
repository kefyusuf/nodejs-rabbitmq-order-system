import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The env schema is validated at import time; tests never touch these
    // services, the values only need to satisfy validation.
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL:
        'postgresql://postgres:postgres@localhost:5432/orders?schema=public',
      RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
      RABBITMQ_EXCHANGE: 'orders',
      STORE: 'in-memory',
      REDIS_URL: 'redis://localhost:6379',
    },
  },
});
