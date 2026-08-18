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
  // Optional, comma-separated allow-list for browser (CORS) clients. When unset
  // no origins are allowed (API-only).
  CORS_ORIGIN: z.string().optional(),
  // Hero: real email delivery behind the notification worker.
  // `console` logs the message without sending (default, dev/demo).
  // `smtp` sends via a generic SMTP server; `resend` via Resend's SMTP relay.
  MAIL_MODE: z.enum(['console', 'smtp', 'resend']).default('console'),
  MAIL_FROM: z.string().default('orders@example.com'),
  MAIL_TO: z.string().default('customer@example.com'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
});

export const env = envSchema
  .superRefine((value, ctx) => {
    if (
      value.NODE_ENV === 'production' &&
      value.JWT_SECRET === 'dev-insecure-change-me'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message:
          'JWT_SECRET must be set to a strong value when NODE_ENV is "production"',
      });
    }
    if (value.MAIL_MODE === 'smtp' && !value.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when MAIL_MODE is "smtp"',
      });
    }
    if (value.MAIL_MODE === 'resend' && !value.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when MAIL_MODE is "resend"',
      });
    }
  })
  .parse(process.env);
