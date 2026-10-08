import { isAuthorizedCronRequest } from '@/lib/meta-recurring-sync.mjs';
import { reconcileRecentCanaryStripePayments } from '@/lib/payment-reconciliation.js';
import { markCanaryPaymentPaid } from '@/lib/payment-state.js';
import { listRecentCompletedCheckoutSessions, retrieveCheckoutSession } from '@/lib/stripe.js';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isAuthorizedCronRequest(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ status: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await reconcileRecentCanaryStripePayments({
      listSessions: listRecentCompletedCheckoutSessions,
      retrieveSession: retrieveCheckoutSession,
      markPaid: markCanaryPaymentPaid,
    });
    if (result.failed > 0) {
      console.error('Stripe payment reconciliation found unresolved paid sessions.', {
        event: 'stripe_payment_reconciliation_failed',
        failed: result.failed,
        sessionIds: result.results.filter((item) => !item.ok).map((item) => item.sessionId),
      });
    }
    return Response.json({ status: result.failed > 0 ? 'partial' : 'ok', ...result }, { status: result.failed > 0 ? 503 : 200 });
  } catch (error) {
    console.error('Stripe payment reconciliation failed.', {
      event: 'stripe_payment_reconciliation_error',
      reason: error?.message || 'unknown',
    });
    return Response.json({ status: 'error' }, { status: 500 });
  }
}
