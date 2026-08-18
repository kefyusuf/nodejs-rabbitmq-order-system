import { OrderProcessedEvent } from '../../shared/types/order';
import { env } from '../../shared/config/env';
import { mailer } from '../../shared/mailer';

/**
 * Sends the customer notification email for a processed order. Uses a real
 * transport (Nodemailer) configured via `MAIL_MODE`; in `console` mode the
 * message is logged instead of delivered.
 */
export async function handleOrderProcessed(
  event: OrderProcessedEvent,
): Promise<void> {
  const subject =
    event.status === 'CONFIRMED'
      ? 'Your order has been confirmed'
      : 'Your order could not be processed';

  const text =
    event.status === 'CONFIRMED'
      ? `Good news! We have confirmed your order ${event.orderId} and will start preparing it shortly.`
      : `Unfortunately we could not process your order ${event.orderId}. No charge will be made.`;

  await mailer.sendMail({
    to: env.MAIL_TO,
    subject,
    text,
  });
}
