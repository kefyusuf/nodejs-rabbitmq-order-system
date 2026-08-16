import { OrderProcessedEvent } from '../../shared/types/order';

/**
 * Simulated customer notification. A real implementation would call an
 * email/SMS provider; for this demo the "email" is logged.
 */
export function handleOrderProcessed(event: OrderProcessedEvent): void {
  const subject =
    event.status === 'CONFIRMED'
      ? 'Your order has been confirmed'
      : 'Your order could not be processed';

  const body =
    event.status === 'CONFIRMED'
      ? 'Good news! We have confirmed your order and will start preparing it shortly.'
      : 'Unfortunately we could not process your order. No charge will be made.';

  console.log(
    [
      '--- sending notification email ---',
      `To:      customer of order ${event.orderId}`,
      `Subject: ${subject}`,
      `Body:    ${body}`,
      `Sent at: ${event.processedAt}`,
      '--------------------------------',
    ].join('\n'),
  );
}
