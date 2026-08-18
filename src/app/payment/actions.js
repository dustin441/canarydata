'use server';

import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { createCanaryCheckoutSession, createCanaryEmbeddedCheckoutSession, ensureCanaryStripeCustomer, getCanaryCheckoutAmountLabel, retrieveCheckoutSession } from '@/lib/stripe';
import { getAuthenticatedBillingContext } from '@/lib/billing';
import { markCanaryPaymentPaid } from '@/lib/payment-state';

function requireBillingContext(context) {
  const { user, districtId, districtName, email, onboardingRequest } = context;
  if (!user) redirect('/login?redirect_to=/payment');

  const organizationName = districtName || onboardingRequest?.organization_name || '';
  if (!organizationName) {
    throw new Error('This login is not tied to a district/account yet. Contact Canary before submitting payment.');
  }
  if (!email || !email.includes('@')) {
    throw new Error('Your login does not have a valid billing email. Contact Canary before submitting payment.');
  }
  if (!user.id || !districtId || String(user.app_metadata?.district_id || '') !== String(districtId)) {
    throw new Error('This login does not have a protected district owner. Contact Canary before submitting payment.');
  }

  return {
    user,
    districtId: String(districtId),
    organizationName,
    email,
    requestId: onboardingRequest?.id || '',
    customerId: user?.app_metadata?.stripe_customer_id || '',
    protectedMetadata: user?.app_metadata || {},
    pricing: context.pricing,
  };
}

function getOrigin() {
  return String(process.env.CANARY_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.canarydata.media').replace(/\/$/, '');
}

async function persistProtectedCustomer(context) {
  const customerId = await ensureCanaryStripeCustomer({
    contactEmail: context.email,
    customerId: context.customerId,
    userId: context.user.id,
    districtId: context.districtId,
  });
  const admin = createAdminClient();
  const { data: savedProtected, error: saveError } = await admin.rpc('patch_canary_protected_app_metadata', {
    p_auth_user_id: context.user.id,
    p_district_id: context.districtId,
    p_expected_customer_id: context.customerId,
    p_expected_app_metadata: null,
    p_patch: { stripe_customer_id: customerId },
  });
  if (saveError || savedProtected?.stripe_customer_id !== customerId || savedProtected?.district_id !== context.districtId) {
    throw new Error('Protected Stripe Customer transactional readback verification failed.');
  }
  if (context.requestId) {
    const { data, error } = await admin
      .from('onboarding_requests')
      .update({ stripe_customer_id: customerId })
      .eq('id', context.requestId)
      .eq('contact_email', context.email)
      .select('id, stripe_customer_id');
    if (error || data?.length !== 1 || data[0].stripe_customer_id !== customerId) {
      throw new Error('Unable to verify the onboarding Stripe Customer binding.');
    }
  }
  return { ...context, customerId, protectedMetadata: savedProtected };
}

async function persistPendingCheckout(context, session, mode) {
  if (!session?.id) throw new Error('Stripe did not return a Checkout Session.');
  const admin = createAdminClient();
  const pendingPatch = {
    stripe_pending_checkout_session_id: session.id,
    stripe_pending_checkout_mode: mode,
    stripe_pending_checkout_expires_at: Number(session.expires_at) > 0 ? new Date(Number(session.expires_at) * 1000).toISOString() : null,
  };
  const { data: savedProtected, error } = await admin.rpc('patch_canary_protected_app_metadata', {
    p_auth_user_id: context.user.id,
    p_district_id: context.districtId,
    p_expected_customer_id: context.customerId,
    p_expected_app_metadata: null,
    p_patch: pendingPatch,
  });
  if (error || savedProtected?.stripe_customer_id !== context.customerId
    || savedProtected?.stripe_pending_checkout_session_id !== session.id
    || savedProtected?.district_id !== context.districtId) {
    throw new Error('Pending Stripe Checkout transactional readback verification failed.');
  }
}

export async function startCanaryCheckout() {
  const context = await persistProtectedCustomer(requireBillingContext(await getAuthenticatedBillingContext()));
  const session = await createCanaryCheckoutSession({
    organizationName: context.organizationName,
    contactEmail: context.email,
    requestId: context.requestId,
    districtId: context.districtId,
    userId: context.user.id,
    customerId: context.customerId,
    protectedMetadata: context.protectedMetadata,
    origin: getOrigin(),
  });

  if (!session?.url) throw new Error('Stripe did not return a checkout URL.');
  await persistPendingCheckout(context, session, 'hosted');
  redirect(session.url);
}

export async function createEmbeddedCanaryCheckout() {
  const context = await persistProtectedCustomer(requireBillingContext(await getAuthenticatedBillingContext()));
  const session = await createCanaryEmbeddedCheckoutSession({
    organizationName: context.organizationName,
    contactEmail: context.email,
    requestId: context.requestId,
    districtId: context.districtId,
    userId: context.user.id,
    customerId: context.customerId,
    protectedMetadata: context.protectedMetadata,
  });

  if (!session?.client_secret || !session?.id) {
    throw new Error('Stripe did not return an embedded checkout session.');
  }
  await persistPendingCheckout(context, session, 'embedded');

  return {
    sessionId: session.id,
    clientSecret: session.client_secret,
    organizationName: context.organizationName,
    email: context.email,
    amountLabel: getCanaryCheckoutAmountLabel(context.email, context.protectedMetadata),
  };
}

export async function saveBillingPurchaseOrder(formData) {
  const context = requireBillingContext(await getAuthenticatedBillingContext());
  const poNumber = String(formData.get('po_number') || '').trim().slice(0, 80);
  const billingOrganizationName = String(formData.get('billing_organization_name') || context.organizationName || '').trim().slice(0, 160);
  const billingContactName = String(formData.get('billing_contact_name') || '').trim().slice(0, 120);
  const billingPhone = String(formData.get('billing_phone') || '').trim().slice(0, 40);
  const billingAddressLine1 = String(formData.get('billing_address_line1') || '').trim().slice(0, 160);
  const billingAddressLine2 = String(formData.get('billing_address_line2') || '').trim().slice(0, 160);
  const billingCity = String(formData.get('billing_city') || '').trim().slice(0, 80);
  const billingState = String(formData.get('billing_state') || '').trim().slice(0, 40);
  const billingZip = String(formData.get('billing_zip') || '').trim().slice(0, 20);
  const supabase = createAdminClient();
  const mergedMetadata = {
    ...(context.user?.user_metadata || {}),
    po_number: poNumber,
    billing_organization_name: billingOrganizationName,
    billing_contact_name: billingContactName,
    billing_phone: billingPhone,
    billing_address_line1: billingAddressLine1,
    billing_address_line2: billingAddressLine2,
    billing_city: billingCity,
    billing_state: billingState,
    billing_zip: billingZip,
    billing_email: context.email,
    billing_terms: 'Net 30',
    amount_due_cents: context.pricing.amountCents,
  };
  if (context.organizationName) mergedMetadata.district_name = context.organizationName;
  const { error: updateError } = await supabase.auth.admin.updateUserById(context.user.id, { user_metadata: mergedMetadata });
  if (updateError) throw new Error('Unable to save billing and purchase-order details.');
  return { ok: true, poNumber, billingOrganizationName, billingContactName, billingPhone, billingAddressLine1, billingAddressLine2, billingCity, billingState, billingZip };
}

export async function confirmEmbeddedCanaryCheckout(sessionId) {
  const context = requireBillingContext(await getAuthenticatedBillingContext());
  const session = await retrieveCheckoutSession(sessionId);

  if (!session?.metadata?.user_id || session.metadata.user_id !== context.user.id) {
    throw new Error('This Stripe session does not match the signed-in user.');
  }
  if (session?.metadata?.district_id !== context.districtId) {
    throw new Error('This Stripe session does not match the signed-in district.');
  }
  if (context.requestId && session?.metadata?.canary_request_id !== context.requestId) {
    throw new Error('This Stripe session does not match the signed-in onboarding request.');
  }
  if (session?.payment_status !== 'paid') {
    return { ok: false, paymentStatus: session?.payment_status || 'unknown' };
  }

  const paidState = await markCanaryPaymentPaid({ session });
  if (!paidState.ok) throw new Error('Unable to persist the confirmed payment state.');

  return { ok: true, paymentStatus: 'paid', organizationName: context.organizationName };
}
