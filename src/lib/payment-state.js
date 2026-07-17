import { createAdminClient } from '@/lib/supabase/admin';

function toIsoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addOneYear(isoDate) {
  const date = new Date(isoDate);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString();
}

function sessionCustomerId(session) {
  if (typeof session?.customer === 'string') return session.customer;
  return session?.customer?.id || null;
}

export async function markCanaryPaymentPaid({ session, paidAt } = {}) {
  if (!session?.id || session?.payment_status !== 'paid') {
    return { ok: false, reason: 'session_not_paid' };
  }

  const userId = session?.metadata?.user_id || '';
  if (!userId) {
    return { ok: false, reason: 'missing_user_id' };
  }

  const supabase = createAdminClient();
  const { data: userResult, error: userError } = await supabase.auth.admin.getUserById(userId);
  const user = userResult?.user;
  if (userError || !user) {
    throw new Error(`Unable to load Canary billing user for Stripe session ${session.id}.`);
  }

  const existing = user.user_metadata || {};
  const sameSession = existing.stripe_checkout_session_id === session.id;
  const paymentPaidAt = sameSession && existing.payment_paid_at
    ? existing.payment_paid_at
    : toIsoDate(paidAt) || toIsoDate(Number(session.created) * 1000) || new Date().toISOString();
  const paidThrough = sameSession && existing.paid_through
    ? existing.paid_through
    : addOneYear(paymentPaidAt);
  const customerId = sessionCustomerId(session) || existing.stripe_customer_id || null;

  const mergedMetadata = {
    ...existing,
    payment_status: 'paid',
    payment_paid_at: paymentPaidAt,
    paid_through: paidThrough,
    access_status: 'active',
    trial_status: 'converted',
    stripe_customer_id: customerId,
    stripe_checkout_session_id: session.id,
    estimate_number: session.metadata?.canary_estimate_number || existing.estimate_number || existing.quote_number || '',
    invoice_number: session.metadata?.canary_invoice_number || existing.invoice_number || '',
    receipt_number: session.metadata?.canary_receipt_number || existing.receipt_number || '',
  };

  if (session.metadata?.district_id) mergedMetadata.district_id = session.metadata.district_id;
  if (session.metadata?.organization_name) mergedMetadata.district_name = session.metadata.organization_name;

  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: mergedMetadata,
  });
  if (updateError) {
    throw new Error(`Unable to persist paid Canary account state for Stripe session ${session.id}.`);
  }

  const requestId = session.metadata?.canary_request_id || '';
  let onboardingUpdated = false;
  if (requestId) {
    const { data, error } = await supabase
      .from('onboarding_requests')
      .update({
        payment_status: 'paid',
        stripe_customer_id: customerId,
        access_status: 'active',
      })
      .eq('id', requestId)
      .select('id');
    onboardingUpdated = !error && Boolean(data?.length);
  }

  return {
    ok: true,
    alreadyProcessed: sameSession && existing.payment_status === 'paid',
    onboardingUpdated,
    userId,
    paidAt: paymentPaidAt,
    paidThrough,
  };
}
