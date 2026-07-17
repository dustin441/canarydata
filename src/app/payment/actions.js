'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createCanaryCheckoutSession, createCanaryEmbeddedCheckoutSession, getCanaryCheckoutAmountLabel, retrieveCheckoutSession } from '@/lib/stripe';
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

  return {
    user,
    districtId: districtId || '',
    organizationName,
    email,
    requestId: onboardingRequest?.id || '',
    customerId: user?.app_metadata?.stripe_customer_id || onboardingRequest?.stripe_customer_id || '',
  };
}

async function getOrigin() {
  const headerStore = await headers();
  return headerStore.get('origin') || `https://${headerStore.get('host') || 'www.canarydata.media'}`;
}

export async function startCanaryCheckout() {
  const context = requireBillingContext(await getAuthenticatedBillingContext());
  const session = await createCanaryCheckoutSession({
    organizationName: context.organizationName,
    contactEmail: context.email,
    requestId: context.requestId,
    districtId: context.districtId,
    userId: context.user.id || '',
    customerId: context.customerId,
    origin: await getOrigin(),
  });

  if (!session?.url) throw new Error('Stripe did not return a checkout URL.');
  redirect(session.url);
}

export async function createEmbeddedCanaryCheckout() {
  const context = requireBillingContext(await getAuthenticatedBillingContext());
  const session = await createCanaryEmbeddedCheckoutSession({
    organizationName: context.organizationName,
    contactEmail: context.email,
    requestId: context.requestId,
    districtId: context.districtId,
    userId: context.user.id || '',
    customerId: context.customerId,
    origin: await getOrigin(),
  });

  if (!session?.client_secret || !session?.id) {
    throw new Error('Stripe did not return an embedded checkout session.');
  }

  return {
    sessionId: session.id,
    clientSecret: session.client_secret,
    organizationName: context.organizationName,
    email: context.email,
    amountLabel: getCanaryCheckoutAmountLabel(context.email),
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
    amount_due_cents: 149900,
  };
  if (context.organizationName) mergedMetadata.district_name = context.organizationName;
  await supabase.auth.admin.updateUserById(context.user.id, {
    user_metadata: mergedMetadata,
  });
  return { ok: true, poNumber, billingOrganizationName, billingContactName, billingPhone, billingAddressLine1, billingAddressLine2, billingCity, billingState, billingZip };
}

export async function confirmEmbeddedCanaryCheckout(sessionId) {
  const context = requireBillingContext(await getAuthenticatedBillingContext());
  const session = await retrieveCheckoutSession(sessionId);

  if (session?.metadata?.user_id && session.metadata.user_id !== context.user.id) {
    throw new Error('This Stripe session does not match the signed-in user.');
  }
  if (session?.metadata?.district_id && context.districtId && session.metadata.district_id !== context.districtId) {
    throw new Error('This Stripe session does not match the signed-in district.');
  }
  if (session?.payment_status !== 'paid') {
    return { ok: false, paymentStatus: session?.payment_status || 'unknown' };
  }

  const paidState = await markCanaryPaymentPaid({ session });
  if (!paidState.ok) {
    throw new Error('Unable to persist the confirmed payment state.');
  }

  return {
    ok: true,
    paymentStatus: 'paid',
    organizationName: context.organizationName,
  };
}
