import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const ordersCreatedTotal = new Counter({
  name: 'orders_created_total',
  help: 'Total number of orders created',
  registers: [registry],
});

export const orderEventsPublishedTotal = new Counter({
  name: 'order_events_published_total',
  help: 'Total number of events published to RabbitMQ',
  registers: [registry],
});

export const orderEventsProcessedTotal = new Counter({
  name: 'order_events_processed_total',
  help: 'Total number of order events processed by the worker',
  registers: [registry],
});

export const inventoryItemsReadTotal = new Counter({
  name: 'inventory_items_read_total',
  help: 'Total number of inventory read-model queries served',
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});
