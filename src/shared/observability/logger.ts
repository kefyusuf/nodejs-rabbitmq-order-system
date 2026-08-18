import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

export const loggerOptions = {
  level,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    reason: pino.stdSerializers.err,
  },
  redact: ['req.headers.cookie', 'req.authorization'],
} as const satisfies pino.LoggerOptions;

// Structured JSON logging in every process. Fastify is configured with the
// same options so a failed startup in the API still produces consistent logs.
export const logger = pino(loggerOptions);
