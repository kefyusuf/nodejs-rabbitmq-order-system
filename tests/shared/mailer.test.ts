import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createTransportMock, sendMailMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn().mockResolvedValue({
    messageId: 'test-1',
    message: { subject: 's' },
  });
  const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
  return { createTransportMock, sendMailMock };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));

vi.stubEnv('MAIL_MODE', 'console');
vi.stubEnv('MAIL_FROM', 'from@example.com');

const { mailer } = await import('../../src/shared/mailer');

describe('mailer', () => {
  beforeEach(() => sendMailMock.mockClear());

  it('sends with the configured from address and recipient', async () => {
    await mailer.sendMail({
      to: 'to@example.com',
      subject: 'Hi',
      text: 'Body',
    });

    expect(createTransportMock).toHaveBeenCalled();
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'from@example.com',
        to: 'to@example.com',
        subject: 'Hi',
        text: 'Body',
      }),
    );
  });

  it('passes an html body when provided', async () => {
    await mailer.sendMail({
      to: 'to@example.com',
      subject: 'Hi',
      text: 'Body',
      html: '<p>Body</p>',
    });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ html: '<p>Body</p>' }),
    );
  });
});
