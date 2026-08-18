import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    // Each e2e file owns its own containers + services; never run them in parallel.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Avoid the global env override from the unit config so the harness can
    // point the services at the containerized Postgres + RabbitMQ.
    env: undefined,
  },
});
