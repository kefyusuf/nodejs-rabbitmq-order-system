export const EXCHANGE_NAME = 'orders';
export const DEAD_LETTER_EXCHANGE_NAME = 'orders.dlx';

export const ROUTING_KEYS = {
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_FAILED: 'order.failed',
  ORDER_PROCESSING_DEAD: 'order.processing.dead',
} as const;

export const QUEUES = {
  ORDER_PROCESSING: 'order.processing',
  ORDER_PROCESSING_RETRY: 'order.processing.retry',
  ORDER_PROCESSING_DLQ: 'order.processing.dlq',
  ORDER_NOTIFICATIONS: 'order.notifications',
} as const;

export const CONSUMER_SETTINGS = {
  PREFETCH_COUNT: 1,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 5_000,
} as const;
