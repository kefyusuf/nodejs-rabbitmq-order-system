import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/shared/mailer', () => ({
  mailer: { sendMail: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../src/shared/config/env', () => ({
  env: { MAIL_TO: 'customer@example.com' },
}));

import { mailer } from '../../../src/shared/mailer';
import { handleOrderProcessed } from '../../../src/notification-worker/handlers/order-processed.handler';

const mocked = vi.mocked(mailer.sendMail);

describe('handleOrderProcessed', () => {
  it('sends a confirmation email for CONFIRMED orders', async () => {
    await handleOrderProcessed({
      orderId: 'o1',
      status: 'CONFIRMED',
      processedAt: new Date().toISOString(),
    });

    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        subject: expect.stringContaining('confirmed'),
      }),
    );
  });

  it('sends a failure email for FAILED orders', async () => {
    await handleOrderProcessed({
      orderId: 'o2',
      status: 'FAILED',
      processedAt: new Date().toISOString(),
    });

    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('could not'),
      }),
    );
  });
});
