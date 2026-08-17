import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

/**
 * beginner seviyesi: STORE=in-memory (varsayılan), DATABASE_URL gerekmez.
 * mid/hero: STORE=redis/postgres. Topoloji beginner için 'basic',
 * gelişmiş seviyeler için 'full' (DLX/retry/DLQ/notifications) ayarlanır.
 */
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1).optional(),
    RABBITMQ_URL: z.string().min(1),
    RABBITMQ_EXCHANGE: z.string().default('orders'),
    STORE: z.enum(['in-memory', 'redis', 'postgres']).default('in-memory'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    TOPOLOGY: z.enum(['basic', 'full']).default('basic'),
  })
  .refine(
    (v) =>
      v.STORE === 'in-memory' || v.STORE === 'redis' ? true : !!v.DATABASE_URL,
    { message: 'DATABASE_URL gerekir (STORE=postgres)' },
  );

export const env = envSchema.parse(process.env);
