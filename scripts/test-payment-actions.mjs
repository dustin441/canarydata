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
  .replace("import { isCanaryAccountHardDenied } from '@/lib/trial-access.mjs';", 'const isCanaryAccountHardDenied = globalThis.__paymentActions.isCanaryAccountHardDenied;')
  .replace("import { requireValidPurchaseOrder } from '@/lib/purchase-order.mjs';", 'const requireValidPurchaseOrder = globalThis.__paymentActions.requireValidPurchaseOrder;');

const context = {
  user: { id: 'user-1', email: 'billing@district.org', app_metadata: { district_id: 'district-1' }, user_metadata: {} },
  districtId: 'district-1', districtName: 'District 1', email: 'billing@district.org', onboardingRequest: null,
  pricing: { amountCents: 500000 },
};
let updateError = { message: 'write failed' };
let requestUpdateError = null;
let requestUpdateCall = null;
let authUpdateCalls = 0;
let stripeCustomerCalls = 0;
globalThis.__paymentActions = {
  redirect: () => {},
  createAdminClient: () => ({
    auth: { admin: { updateUserById: async () => { authUpdateCalls += 1; return { error: updateError }; } } },
    from: (table) => {
      assert.equal(table, 'onboarding_requests');
      const filters = {};
      const builder = {
        update: (values) => { requestUpdateCall = { values, filters }; return builder; },
        eq: (field, value) => { filters[field] = value; return builder; },
        select: () => builder,
        maybeSingle: async () => requestUpdateError
          ? { data: null, error: requestUpdateError }
          : { data: { id: filters.id }, error: null },
      };
      return builder;
    },
  }),
  getAuthenticatedBillingContext: async () => context,
  createCanaryCheckoutSession: async () => ({}),
  createCanaryEmbeddedCheckoutSession: async () => ({}),
  ensureCanaryStripeCustomer: async () => { stripeCustomerCalls += 1; return 'cus-1'; },
  getCanaryCheckoutAmountLabel: () => '$5,000 annual access',
  retrieveCheckoutSession: async () => ({}),
  markCanaryPaymentPaid: async () => ({ ok: true }),
  isCanaryPaymentCovered: (status, paidThrough) => status === 'paid' || (status === 'complimentary' && Boolean(paidThrough) && new Date(paidThrough) > new Date()),
  isCanaryAccountHardDenied: (metadata) => metadata?.account_enabled === false || ['revoked', 'disabled', 'suspended_security', 'terminated'].includes(metadata?.access_status),
  requireValidPurchaseOrder: (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || /^(?:n\/?a|none|pending|tbd|test|testing|sample|demo|0+)$/i.test(normalized)) throw new Error('Enter the district-issued purchase order number, not a placeholder.');
    return normalized;
  },
};
const { createEmbeddedCanaryCheckout, saveBillingPurchaseOrder, startCanaryCheckout } = await import(`data:text/javascript;base64,${Buffer.from(testable).toString('base64')}`);
const form = new FormData();
form.set('po_number', 'PO-1');
await assert.rejects(() => saveBillingPurchaseOrder(form), /Unable to save billing and purchase-order details/);
updateError = null;
const saved = await saveBillingPurchaseOrder(form);
assert.equal(saved.ok, true);
assert.equal(saved.poNumber, 'PO-1');
context.onboardingRequest = { id: 'request-1', organization_name: 'District 1', payment_status: 'pending' };
requestUpdateCall = null;
const centrallySaved = await saveBillingPurchaseOrder(form);
assert.equal(centrallySaved.ok, true);
assert.deepEqual(requestUpdateCall, {
  values: {
    po_number: 'PO-1',
    billing_phone: '',
    billing_address_line1: '',
    billing_address_line2: '',
    billing_city: '',
    billing_state: '',
    billing_zip: '',
  },
  filters: { id: 'request-1', contact_email: 'billing@district.org' },
});
requestUpdateError = { message: 'central write failed' };
const authCallsBeforeCentralFailure = authUpdateCalls;
await assert.rejects(() => saveBillingPurchaseOrder(form), /Unable to save the central billing and purchase-order record/);
assert.equal(authUpdateCalls, authCallsBeforeCentralFailure, 'Auth metadata must not change when the authoritative central write fails');
requestUpdateError = null;
updateError = { message: 'auth sync failed' };
await assert.rejects(() => saveBillingPurchaseOrder(form), /saved centrally, but the account billing profile could not be synchronized/);
updateError = null;
delete context.onboardingRequest;
for (const invalidPo of ['', 'N/A', 'pending', 'test', '0000']) {
  const invalidForm = new FormData();
  invalidForm.set('po_number', invalidPo);
  await assert.rejects(() => saveBillingPurchaseOrder(invalidForm), /purchase order|placeholder/i);
}

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
