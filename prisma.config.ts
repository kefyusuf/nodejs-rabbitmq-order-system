import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Real URL is read at migrate/runtime from DATABASE_URL. A placeholder is
    // enough for `prisma generate`, which does not open a connection.
    url:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/orders',
  },
});
