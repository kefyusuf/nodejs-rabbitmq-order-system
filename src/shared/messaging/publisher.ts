import { trace } from '@opentelemetry/api';
import { getChannel } from './connection';
import { EXCHANGE_NAME } from './constants';

const tracer = trace.getTracer('order-messaging');

export async function publishMessage(
  routingKey: string,
  payload: unknown,
  messageId?: string,
): Promise<void> {
  await tracer.startActiveSpan(`publish ${routingKey}`, async (span) => {
    try {
      const channel = await getChannel();
      const content = Buffer.from(JSON.stringify(payload));

      channel.publish(EXCHANGE_NAME, routingKey, content, {
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
