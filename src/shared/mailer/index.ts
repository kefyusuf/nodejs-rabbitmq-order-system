import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Builds the Nodemailer transport from configuration.
 *
 * - `console`: a JSON transport that serialises the message for logging only —
 *   nothing is sent. This is the default so the demo runs with zero credentials.
 * - `smtp`: a generic SMTP server (host/port/user/pass from env).
 * - `resend`: Resend's SMTP relay (https://resend.com/docs/send-with-smtp),
 *   authenticated with the API key.
 */
function buildTransport(): Transporter {
  switch (env.MAIL_MODE) {
    case 'smtp':
      return nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
        pool: true,
      });
    case 'resend':
      return nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: 587,
        secure: false,
        auth: { user: 'resend', pass: env.RESEND_API_KEY },
        pool: true,
      });
    case 'console':
    default:
      return nodemailer.createTransport({ jsonTransport: true });
  }
}

const transport = buildTransport();

export const mailer = {
  async sendMail(message: MailMessage): Promise<void> {
    const info = await transport.sendMail({
      from: env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    if (env.MAIL_MODE === 'console') {
      // info.message is the serialised RFC822 message (JSON transport).
      console.log('[mailer:console] email not sent:', JSON.stringify(info.message));
    } else {
      console.log(`[mailer] sent email to ${message.to} (${info.messageId})`);
    }
  },
};
