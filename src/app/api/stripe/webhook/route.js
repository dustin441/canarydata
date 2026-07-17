import { NextResponse } from 'next/server';
import { markCanaryPaymentPaid } from '@/lib/payment-state';
import { verifyStripeWebhookSignature } from '@/lib/stripe-webhook';

export const runtime = 'nodejs';

const PAID_CHECKOUT_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
]);

export async function POST(request) {
  const payload = await request.text();
  const signatureHeader = request.headers.get('stripe-signature') || '';

  try {
    verifyStripeWebhookSignature({
      payload,
      signatureHeader,
      secret: process.env.STRIPE_WEBHOOK_SECRET || process.env.CANARY_STRIPE_WEBHOOK_SECRET || '',
    });
  } catch (error) {
    console.warn('Rejected Stripe webhook:', error?.message || 'invalid signature');
    return NextResponse.json({ received: false, error: 'invalid_signature' }, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ received: false, error: 'invalid_json' }, { status: 400 });
  }

  if (!PAID_CHECKOUT_EVENTS.has(event?.type)) {
    return NextResponse.json({ received: true, handled: false });
  }

  const session = event?.data?.object;
  if (session?.payment_status !== 'paid') {
    return NextResponse.json({ received: true, handled: false, reason: 'session_not_paid' });
  }

  try {
    const result = await markCanaryPaymentPaid({
      session,
      paidAt: Number(event.created) ? Number(event.created) * 1000 : undefined,
    });
    if (!result.ok) {
      console.error('Stripe webhook could not reconcile Canary payment:', result.reason);
      return NextResponse.json({ received: true, handled: false, reason: result.reason });
    }

    return NextResponse.json({
      received: true,
      handled: true,
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    console.error('Stripe webhook payment reconciliation failed:', error?.message || error);
    return NextResponse.json({ received: false, error: 'reconciliation_failed' }, { status: 500 });
  }
}
