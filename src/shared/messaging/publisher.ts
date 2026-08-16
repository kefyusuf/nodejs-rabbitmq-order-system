import { getChannel } from './connection';
import { EXCHANGE_NAME } from './constants';

export async function publishMessage(
  routingKey: string,
  payload: unknown,
): Promise<void> {
  const channel = await getChannel();
  const content = Buffer.from(JSON.stringify(payload));

  channel.publish(EXCHANGE_NAME, routingKey, content, {
    contentType: 'application/json',
    persistent: true,
  });
}
