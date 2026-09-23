import { trace } from '@opentelemetry/api';
import { ConfirmChannel, Options } from 'amqplib';
import { getChannel } from './connection';
import { EXCHANGE_NAME } from './constants';

const tracer = trace.getTracer('order-messaging');

/**
 * Publish on a confirm channel and resolve only after the broker acks.
 * Callers can then safely record the message as delivered (outbox).
 */
function publishConfirmed(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  content: Buffer,
  options: Options.Publish,
): Promise<void> {
  return new Promise((resolve, reject) => {
    channel.publish(exchange, routingKey, content, options, (error) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve();
    });
  });
}

export async function publishMessage(
  routingKey: string,
  payload: unknown,
  messageId?: string,
): Promise<void> {
  await tracer.startActiveSpan(`publish ${routingKey}`, async (span) => {
    try {
      const channel = await getChannel();
      const content = Buffer.from(JSON.stringify(payload));

      await publishConfirmed(channel, EXCHANGE_NAME, routingKey, content, {
        contentType: 'application/json',
        persistent: true,
        messageId,
      });

      span.setAttribute('messaging.system', 'rabbitmq');
      span.setAttribute('messaging.destination.name', EXCHANGE_NAME);
      span.setAttribute('messaging.rabbitmq.routing_key', routingKey);
    } finally {
      span.end();
    }
  });
}

/**
 * Publish raw bytes to a specific queue (default exchange). Used by the
 * delayed-retry path so original message properties survive redelivery.
 */
export async function publishToQueue(
  queue: string,
  content: Buffer,
  options: Options.Publish,
): Promise<void> {
  const channel = await getChannel();
  await publishConfirmed(channel, '', queue, content, options);
}

/**
 * Park a failed message on its retry queue, preserving identity properties
 * (especially `messageId`) so consumer idempotency still matches after
 * redelivery and after outbox at-least-once duplicates.
 */
export async function republishForRetry(
  retryQueue: string,
  content: Buffer,
  properties: {
    contentType?: string | undefined;
    messageId?: string | undefined;
    correlationId?: string | undefined;
    timestamp?: number | undefined;
    type?: string | undefined;
    headers?: Record<string, unknown> | undefined;
  },
  retryHeader: string,
  retryCount: number,
): Promise<void> {
  await publishToQueue(retryQueue, content, {
    contentType: properties.contentType ?? 'application/json',
    persistent: true,
    messageId: properties.messageId,
    correlationId: properties.correlationId,
    timestamp: properties.timestamp,
    type: properties.type,
    headers: {
      ...properties.headers,
      [retryHeader]: retryCount,
    },
  });
}
