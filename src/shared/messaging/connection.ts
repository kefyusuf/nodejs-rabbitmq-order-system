import amqp, { Channel, Connection } from 'amqplib';
import { env } from '../config/env';
import { EXCHANGE_NAME, QUEUES, ROUTING_KEYS } from './constants';

let connection: Connection | null = null;
let channel: Channel | null = null;

export async function getChannel(): Promise<Channel> {
  if (channel) {
    return channel;
  }

  connection = await amqp.connect(env.RABBITMQ_URL);
  channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
  await channel.assertQueue(QUEUES.ORDER_PROCESSING, { durable: true });
  await channel.bindQueue(
    QUEUES.ORDER_PROCESSING,
    EXCHANGE_NAME,
    ROUTING_KEYS.ORDER_CREATED,
  );

  return channel;
}

export async function closeMessaging(): Promise<void> {
  if (channel) {
    await channel.close();
    channel = null;
  }

  if (connection) {
    await connection.close();
    connection = null;
  }
}
