export const EXCHANGE_NAME = 'orders';

export const ROUTING_KEYS = {
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_FAILED: 'order.failed',
} as const;

export const QUEUES = {
  ORDER_PROCESSING: 'order.processing',
} as const;
