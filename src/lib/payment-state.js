import { createAdminClient } from '@/lib/supabase/admin';
import { resolvePaymentPricingSnapshot } from './payment-pricing.js';
import { INTRODUCTORY_ANNUAL_PRICE_CENTS, PRICING_CUTOFF_AT, PRICING_POLICY_VERSION, resolveCanaryPricing } from './pricing.js';
import { isCanaryAccountHardDenied } from './trial-access.mjs';

function toIsoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sessionCustomer(session) {
  return typeof session?.customer === 'object' ? session.customer : null;
}

function sessionChargeTimestamp(session) {
  const latestCharge = session?.payment_intent?.latest_charge;
  const created = typeof latestCharge === 'object' ? Number(latestCharge?.created) : null;
  return Number.isFinite(created) && created > 0 ? toIsoDate(created * 1000) : null;
}

function expectedStripeLivemode() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || process.env.CANARY_STRIPE_SECRET_KEY || '');
  return secretKey.startsWith('sk_live_');
}

async function validateOnboardingOwnership(supabase, { requestId, userEmail, organizationName, sessionId }) {
  if (!requestId) return null;
  const { data: onboarding, error } = await supabase
    .from('onboarding_requests')
    .select('id, contact_email, organization_name, access_status')
    .eq('id', requestId)
    .eq('contact_email', userEmail)
    .maybeSingle();
  if (error || !onboarding) {
    throw new Error(`Stripe session ${sessionId} onboarding request does not match its protected Canary user.`);
  }
  if (isCanaryAccountHardDenied({ access_status: onboarding.access_status })) {
    throw new Error(`Stripe session ${sessionId} cannot reactivate a disabled Canary onboarding account.`);
  }
  const expectedOrganization = String(organizationName || '').trim();
  if (expectedOrganization && String(onboarding.organization_name || '').trim() !== expectedOrganization) {
    throw new Error(`Stripe session ${sessionId} organization does not match its onboarding request.`);
  }
  return onboarding;
}

export async function markCanaryPaymentPaid({ session, eventId = '' } = {}) {
  if (!session?.id || session?.payment_status !== 'paid') {
    return { ok: false, reason: 'session_not_paid' };
  }
  if (session.mode !== 'payment' || session.status !== 'complete') {
    throw new Error(`Stripe session ${session.id} is not a completed one-time payment Checkout Session.`);
  }
  if (typeof session.livemode !== 'boolean' || session.livemode !== expectedStripeLivemode()) {
    throw new Error(`Stripe session ${session.id} live/test mode does not match this Canary deployment.`);
  }

  const userId = String(session?.metadata?.user_id || '');
  if (!userId) return { ok: false, reason: 'missing_user_id' };

  const supabase = createAdminClient();
  const sessionDistrictId = String(session.metadata?.district_id || '');
  const replayCustomer = sessionCustomer(session);
  const { data: existingFulfillment, error: existingError } = await supabase
    .from('canary_payment_fulfillments')
    .select('checkout_session_id, stripe_event_id, auth_user_id, district_id, stripe_customer_id, result')
    .eq('checkout_session_id', session.id)
    .maybeSingle();
  if (existingError) throw new Error(`Unable to verify prior fulfillment for Stripe session ${session.id}.`);
  if (existingFulfillment) {
    const ownedReplay = String(existingFulfillment.auth_user_id) === userId
      && String(existingFulfillment.district_id) === sessionDistrictId
      && String(existingFulfillment.stripe_customer_id) === String(replayCustomer?.id || '');
    if (!ownedReplay || (existingFulfillment.stripe_event_id && eventId && existingFulfillment.stripe_event_id !== eventId)) {
      throw new Error(`Stripe session ${session.id} prior fulfillment ownership does not match this event.`);
    }
    if (!eventId) return { ...(existingFulfillment.result || {}), alreadyProcessed: true };
    const chargePaidAt = sessionChargeTimestamp(session);
    if (!chargePaidAt) throw new Error(`Stripe session ${session.id} is missing an authoritative expanded charge timestamp.`);
    const { data: replayResult, error: replayError } = await supabase.rpc('fulfill_canary_stripe_payment', {
      p_checkout_session_id: session.id,
      p_stripe_event_id: String(eventId),
      p_auth_user_id: userId,
      p_expected_email: String(session.metadata?.contact_email || '').trim().toLowerCase(),
      p_district_id: sessionDistrictId,
      p_customer_id: String(replayCustomer?.id || ''),
      p_request_id: String(session.metadata?.canary_request_id || ''),
      p_organization_name: String(session.metadata?.organization_name || '').trim(),
      p_charge_paid_at: chargePaidAt,
      p_is_test_purchase: session.metadata?.canary_test_purchase === 'true',
      p_expected_app_metadata: {},
      p_app_patch: {},
      p_user_patch: {},
    });
    if (replayError || !replayResult?.ok) throw new Error(`Unable to atomically claim replay event for Stripe session ${session.id}.`);
    return replayResult;
  }
  const { data: userResult, error: userError } = await supabase.auth.admin.getUserById(userId);
  const user = userResult?.user;
  if (userError || !user) throw new Error(`Unable to load Canary billing user for Stripe session ${session.id}.`);

  const existingProtected = user.app_metadata || {};
  if (isCanaryAccountHardDenied(existingProtected)) {
    throw new Error(`Stripe session ${session.id} cannot reactivate a disabled Canary account.`);
  }
  const existingDisplay = user.user_metadata || {};
  const userEmail = String(user.email || '').trim().toLowerCase();
  const sessionEmail = String(session.metadata?.contact_email || '').trim().toLowerCase();
  if (!userEmail || sessionEmail !== userEmail) {
    throw new Error(`Stripe session ${session.id} contact email does not match its protected Canary user.`);
  }

  const protectedDistrictId = String(existingProtected.district_id || '');
  if (!protectedDistrictId || !sessionDistrictId || sessionDistrictId !== protectedDistrictId) {
    throw new Error(`Stripe session ${session.id} district does not match its protected Canary user.`);
  }

  const customer = sessionCustomer(session);
  const customerId = String(customer?.id || '');
  if (!customerId || customer?.deleted) {
    throw new Error(`Stripe session ${session.id} is missing an expanded active Stripe customer.`);
  }
  if (!existingProtected.stripe_customer_id || existingProtected.stripe_customer_id !== customerId) {
    throw new Error(`Stripe session ${session.id} customer does not match its protected Canary user.`);
  }
  if (String(customer.metadata?.user_id || '') !== userId) {
    throw new Error(`Stripe session ${session.id} customer is not owned by its protected Canary user.`);
  }
  if (String(customer.email || '').trim().toLowerCase() !== userEmail) {
    throw new Error(`Stripe session ${session.id} customer email does not match its protected Canary user.`);
  }
  if (!String(customer.metadata?.district_id || '') || String(customer.metadata?.district_id || '') !== protectedDistrictId) {
    throw new Error(`Stripe session ${session.id} customer district does not match its protected Canary user.`);
  }

  const chargePaidAt = sessionChargeTimestamp(session);
  if (!chargePaidAt) {
    throw new Error(`Stripe session ${session.id} is missing an authoritative expanded charge timestamp.`);
  }

  // Cutoff and snapshot validation always use the current expanded latest Charge.
  // Stored payment timestamps are retained only by the transactional RPC for idempotent display state.
  const snapshot = resolvePaymentPricingSnapshot(session, { paidAt: chargePaidAt });
  const requestId = String(session.metadata?.canary_request_id || '');
  const organizationName = String(session.metadata?.organization_name || '').trim();
  const onboarding = await validateOnboardingOwnership(supabase, {
    requestId,
    userEmail,
    organizationName,
    sessionId: session.id,
  });

  let appPatch;
  let userPatch = {};
  if (snapshot.isTestPurchase) {
    if (existingProtected.is_test_account !== true) {
      throw new Error(`Stripe session ${session.id} test purchase is not tied to a protected Canary test account.`);
    }
    appPatch = {
      last_test_purchase_status: 'paid',
      last_test_purchase_at: chargePaidAt,
      last_test_purchase_amount_cents: snapshot.paidAmountCents,
      last_test_checkout_session_id: session.id,
      last_test_stripe_customer_id: customerId,
    };
  } else {
    const accountPricing = resolveCanaryPricing({ protectedMetadata: existingProtected, now: new Date(chargePaidAt) });
    const legacySnapshot = snapshot.policyVersion === 'legacy-pre-cutoff-payment';
    if (accountPricing.amountCents !== snapshot.paidAmountCents
      || accountPricing.renewalAmountCents !== snapshot.renewalAmountCents
      || (!legacySnapshot && String(accountPricing.reason || '') !== String(snapshot.reason || ''))) {
      throw new Error(`Stripe session ${session.id} pricing does not match the protected Canary account entitlement.`);
    }
    if (snapshot.paidAmountCents === INTRODUCTORY_ANNUAL_PRICE_CENTS
      && Date.parse(chargePaidAt) >= Date.parse(PRICING_CUTOFF_AT)
      && !accountPricing.locked) {
      throw new Error(`Stripe session ${session.id} does not have a protected pre-cutoff introductory entitlement.`);
    }

    const estimateNumber = session.metadata?.canary_estimate_number || existingProtected.estimate_number || existingDisplay.estimate_number || existingDisplay.quote_number || '';
    const invoiceNumber = session.metadata?.canary_invoice_number || existingProtected.invoice_number || existingDisplay.invoice_number || '';
    const receiptNumber = session.metadata?.canary_receipt_number || existingProtected.receipt_number || existingDisplay.receipt_number || '';
    const legacyPayment = snapshot.policyVersion === 'legacy-pre-cutoff-payment';
    appPatch = {
      payment_status: 'paid',
      access_status: 'active',
      trial_status: 'converted',
      stripe_customer_id: customerId,
      stripe_checkout_session_id: session.id,
      stripe_pending_checkout_session_id: null,
      stripe_pending_checkout_mode: null,
      stripe_pending_checkout_expires_at: null,
      payment_amount_cents: snapshot.paidAmountCents,
      payment_currency: snapshot.paidCurrency,
      pricing_policy_version: legacyPayment ? PRICING_POLICY_VERSION : (snapshot.policyVersion || existingProtected.pricing_policy_version || ''),
      pricing_entitlement_reason: legacyPayment ? 'legacy_paid_customer_introductory_renewal' : (snapshot.reason || existingProtected.pricing_entitlement_reason || ''),
      estimate_number: estimateNumber,
      invoice_number: invoiceNumber,
      receipt_number: receiptNumber,
      annual_price_cents: snapshot.paidAmountCents,
      renewal_price_cents: snapshot.renewalAmountCents,
      pricing_lock_status: 'approved',
      pricing_locked_at: snapshot.lockedAt || chargePaidAt,
    };
    userPatch = {
      district_name: organizationName || existingDisplay.district_name,
      estimate_number: estimateNumber,
      invoice_number: invoiceNumber,
      receipt_number: receiptNumber,
    };
  }

  const { data, error } = await supabase.rpc('fulfill_canary_stripe_payment', {
    p_checkout_session_id: session.id,
    p_stripe_event_id: String(eventId || ''),
    p_auth_user_id: userId,
    p_expected_email: userEmail,
    p_district_id: protectedDistrictId,
    p_customer_id: customerId,
    p_request_id: onboarding?.id || '',
    p_organization_name: organizationName,
    p_charge_paid_at: chargePaidAt,
    p_is_test_purchase: snapshot.isTestPurchase,
    p_expected_app_metadata: existingProtected,
    p_app_patch: appPatch,
    p_user_patch: userPatch,
  });
  if (error || !data?.ok) {
    throw new Error(`Unable to atomically persist Canary payment state for Stripe session ${session.id}.`);
  }
  return data;
}
