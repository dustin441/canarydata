import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/app/payment/actions.js', import.meta.url), 'utf8');
const testable = source
  .replace("'use server';", '')
  .replace("import { redirect } from 'next/navigation';", 'const redirect = globalThis.__paymentActions.redirect;')
  .replace("import { createAdminClient } from '@/lib/supabase/admin';", 'const createAdminClient = globalThis.__paymentActions.createAdminClient;')
  .replace("import { createCanaryCheckoutSession, createCanaryEmbeddedCheckoutSession, ensureCanaryStripeCustomer, getCanaryCheckoutAmountLabel, retrieveCheckoutSession } from '@/lib/stripe';", 'const { createCanaryCheckoutSession, createCanaryEmbeddedCheckoutSession, ensureCanaryStripeCustomer, getCanaryCheckoutAmountLabel, retrieveCheckoutSession } = globalThis.__paymentActions;')
  .replace("import { getAuthenticatedBillingContext } from '@/lib/billing';", 'const getAuthenticatedBillingContext = globalThis.__paymentActions.getAuthenticatedBillingContext;')
  .replace("import { markCanaryPaymentPaid } from '@/lib/payment-state';", 'const markCanaryPaymentPaid = globalThis.__paymentActions.markCanaryPaymentPaid;')
  .replace("import { isCanaryPaymentCovered } from '@/lib/payment-status.mjs';", 'const isCanaryPaymentCovered = globalThis.__paymentActions.isCanaryPaymentCovered;')
  .replace("import { isCanaryAccountHardDenied } from '@/lib/trial-access.mjs';", 'const isCanaryAccountHardDenied = globalThis.__paymentActions.isCanaryAccountHardDenied;');

const context = {
  user: { id: 'user-1', email: 'billing@district.org', app_metadata: { district_id: 'district-1' }, user_metadata: {} },
  districtId: 'district-1', districtName: 'District 1', email: 'billing@district.org', onboardingRequest: null,
  pricing: { amountCents: 500000 },
};
let updateError = { message: 'write failed' };
let stripeCustomerCalls = 0;
globalThis.__paymentActions = {
  redirect: () => {},
  createAdminClient: () => ({ auth: { admin: { updateUserById: async () => ({ error: updateError }) } } }),
  getAuthenticatedBillingContext: async () => context,
  createCanaryCheckoutSession: async () => ({}),
  createCanaryEmbeddedCheckoutSession: async () => ({}),
  ensureCanaryStripeCustomer: async () => { stripeCustomerCalls += 1; return 'cus-1'; },
  getCanaryCheckoutAmountLabel: () => '$5,000 annual access',
  retrieveCheckoutSession: async () => ({}),
  markCanaryPaymentPaid: async () => ({ ok: true }),
  isCanaryPaymentCovered: (status, paidThrough) => status === 'paid' || (status === 'complimentary' && Boolean(paidThrough) && new Date(paidThrough) > new Date()),
  isCanaryAccountHardDenied: (metadata) => metadata?.account_enabled === false || ['revoked', 'disabled', 'suspended_security', 'terminated'].includes(metadata?.access_status),
};
const { createEmbeddedCanaryCheckout, saveBillingPurchaseOrder, startCanaryCheckout } = await import(`data:text/javascript;base64,${Buffer.from(testable).toString('base64')}`);
const form = new FormData();
form.set('po_number', 'PO-1');
await assert.rejects(() => saveBillingPurchaseOrder(form), /Unable to save billing and purchase-order details/);
updateError = null;
const saved = await saveBillingPurchaseOrder(form);
assert.equal(saved.ok, true);
assert.equal(saved.poNumber, 'PO-1');

context.user.app_metadata.payment_status = 'complimentary';
context.user.app_metadata.paid_through = '2099-01-01T00:00:00Z';
await assert.rejects(() => startCanaryCheckout(), /Payment is not required/);
await assert.rejects(() => createEmbeddedCanaryCheckout(), /Payment is not required/);
assert.equal(stripeCustomerCalls, 0);
context.user.app_metadata = { district_id: 'district-1', payment_status: 'pending', access_status: 'revoked' };
await assert.rejects(() => startCanaryCheckout(), /cannot reactivate a disabled Canary account/);
await assert.rejects(() => createEmbeddedCanaryCheckout(), /cannot reactivate a disabled Canary account/);
await assert.rejects(() => saveBillingPurchaseOrder(form), /cannot reactivate a disabled Canary account/);
context.user.app_metadata = { district_id: 'district-1', payment_status: 'pending', access_status: 'active' };
context.accountAccess = { allowed: false, reason: 'account_revoked' };
await assert.rejects(() => startCanaryCheckout(), /cannot reactivate a disabled Canary account/);
delete context.accountAccess;

assert.doesNotMatch(source, /from 'next\/headers'/);
assert.match(source, /CANARY_APP_ORIGIN/);
assert.match(source, /patch_canary_protected_app_metadata/);
assert.match(source, /bind_canary_stripe_customer/);
assert.match(source, /mode === 'embedded' \? 'embedded_page' : 'hosted_page'/);
assert.match(source, /session\?\.mode === 'payment'/);
assert.match(source, /Protected Stripe Customer transactional readback verification failed/);
assert.match(source, /Pending Stripe Checkout transactional readback verification failed/);

console.log('Payment action failure and canonical-origin tests passed.');
