import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_EXCHANGE: z.string().default('orders'),
  STORE: z.enum(['in-memory', 'redis', 'postgres']).default('postgres'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // Hero: JWT auth + optional OpenTelemetry export.
  JWT_SECRET: z.string().min(1).default('dev-insecure-change-me'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export const env = envSchema.parse(process.env);
