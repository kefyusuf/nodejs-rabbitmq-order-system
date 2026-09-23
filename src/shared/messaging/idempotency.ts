import { createHash } from 'node:crypto';
import { ConsumeMessage } from 'amqplib';
import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../db/prisma';

export function getMessageId(message: ConsumeMessage): string {
  if (message.properties.messageId) {
    return message.properties.messageId;
  }
  return createHash('sha256').update(message.content).digest('hex');
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * Claim a message id after successful handling. Returns false when another
 * consumer already claimed it (duplicate delivery).
 */
export async function markProcessed(
  messageId: string,
  queue: string,
): Promise<boolean> {
  try {
    await prisma.processedMessage.create({ data: { messageId, queue } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return false;
    }
    throw error;
  }
}

export async function isAlreadyProcessed(messageId: string): Promise<boolean> {
  const existing = await prisma.processedMessage.findUnique({
    where: { messageId },
  });
  return existing !== null;
}
