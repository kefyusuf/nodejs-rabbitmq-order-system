export const EXCHANGE_NAME = 'orders';
export const DEAD_LETTER_EXCHANGE_NAME = 'orders.dlx';

export const ROUTING_KEYS = {
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_FAILED: 'order.failed',
  ORDER_PROCESSING_DEAD: 'order.processing.dead',
  ORDER_NOTIFICATIONS_DEAD: 'order.notifications.dead',
  INVENTORY_RESERVED: 'inventory.reserved',
  INVENTORY_RESERVATION_FAILED: 'inventory.reservation.failed',
  INVENTORY_RELEASE: 'inventory.release',
  INVENTORY_RESERVE_DEAD: 'inventory.reserve.dead',
  INVENTORY_RELEASE_DEAD: 'inventory.release.dead',
} as const;

export const QUEUES = {
  ORDER_PROCESSING: 'order.processing',
  ORDER_PROCESSING_RETRY: 'order.processing.retry',
  ORDER_PROCESSING_DLQ: 'order.processing.dlq',
  ORDER_NOTIFICATIONS: 'order.notifications',
  ORDER_NOTIFICATIONS_RETRY: 'order.notifications.retry',
  ORDER_NOTIFICATIONS_DLQ: 'order.notifications.dlq',
  INVENTORY_RESERVE: 'inventory.reserve',
  INVENTORY_RESERVE_RETRY: 'inventory.reserve.retry',
  INVENTORY_RESERVE_DLQ: 'inventory.reserve.dlq',
  INVENTORY_RELEASE: 'inventory.release',
  INVENTORY_RELEASE_RETRY: 'inventory.release.retry',
  INVENTORY_RELEASE_DLQ: 'inventory.release.dlq',
} as const;

export const CONSUMER_SETTINGS = {
  PREFETCH_COUNT: 1,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 5_000,
} as const;
