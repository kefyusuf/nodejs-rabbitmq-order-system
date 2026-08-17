import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

/**
 * mid seviyesi: STORE=in-memory|redis (varsayılan in-memory),
 * TOPOLOGY='full' (DLX/retry/DLQ + notification fan-out).
 * hero'da postgres + transactional outbox eklenir.
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
    STORE: z.enum(['in-memory', 'redis']).default('in-memory'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    TOPOLOGY: z.enum(['basic', 'full']).default('full'),
  })
  .refine((v) => (v.STORE === 'redis' ? !!v.REDIS_URL : true), {
    message: 'REDIS_URL gerekir (STORE=redis)',
  });

export const env = envSchema.parse(process.env);
