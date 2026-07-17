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

  const existingProtected = user.app_metadata || {};
  const existingDisplay = user.user_metadata || {};
  const sameSession = existingProtected.stripe_checkout_session_id === session.id;
  const paymentPaidAt = sameSession && existingProtected.payment_paid_at
    ? existingProtected.payment_paid_at
    : toIsoDate(paidAt) || toIsoDate(Number(session.created) * 1000) || new Date().toISOString();
  const paidThrough = sameSession && existingProtected.paid_through
    ? existingProtected.paid_through
    : addOneYear(paymentPaidAt);
  const customerId = sessionCustomerId(session) || existingProtected.stripe_customer_id || null;

  const protectedMetadata = {
    ...existingProtected,
    payment_status: 'paid',
    payment_paid_at: paymentPaidAt,
    paid_through: paidThrough,
    access_status: 'active',
    trial_status: 'converted',
    stripe_customer_id: customerId,
    stripe_checkout_session_id: session.id,
    estimate_number: session.metadata?.canary_estimate_number || existingProtected.estimate_number || existingDisplay.estimate_number || existingDisplay.quote_number || '',
    invoice_number: session.metadata?.canary_invoice_number || existingProtected.invoice_number || existingDisplay.invoice_number || '',
    receipt_number: session.metadata?.canary_receipt_number || existingProtected.receipt_number || existingDisplay.receipt_number || '',
  };

  if (session.metadata?.district_id) protectedMetadata.district_id = session.metadata.district_id;

  const displayMetadata = {
    ...existingDisplay,
    district_name: session.metadata?.organization_name || existingDisplay.district_name,
    estimate_number: protectedMetadata.estimate_number,
    invoice_number: protectedMetadata.invoice_number,
    receipt_number: protectedMetadata.receipt_number,
  };

  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: protectedMetadata,
    user_metadata: displayMetadata,
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
    alreadyProcessed: sameSession && existingProtected.payment_status === 'paid',
    onboardingUpdated,
    userId,
    paidAt: paymentPaidAt,
    paidThrough,
  };
}
