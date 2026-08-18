import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolvePaymentPricingSnapshot } from '../src/lib/payment-pricing.js';
import { INTRODUCTORY_ANNUAL_PRICE_CENTS, PRICING_CUTOFF_AT, PRICING_POLICY_VERSION, resolveCanaryPricing } from '../src/lib/pricing.js';

process.env.STRIPE_SECRET_KEY = 'sk_test_payment_state';

const source = await readFile(new URL('../src/lib/payment-state.js', import.meta.url), 'utf8');
const testable = source
  .replace("import { createAdminClient } from '@/lib/supabase/admin';", 'const createAdminClient = () => globalThis.__paymentStateAdmin;')
  .replace("import { resolvePaymentPricingSnapshot } from './payment-pricing.js';", 'const resolvePaymentPricingSnapshot = globalThis.__resolvePaymentPricingSnapshot;')
  .replace("import { INTRODUCTORY_ANNUAL_PRICE_CENTS, PRICING_CUTOFF_AT, PRICING_POLICY_VERSION, resolveCanaryPricing } from './pricing.js';", 'const { INTRODUCTORY_ANNUAL_PRICE_CENTS, PRICING_CUTOFF_AT, PRICING_POLICY_VERSION, resolveCanaryPricing } = globalThis.__pricing;');
globalThis.__resolvePaymentPricingSnapshot = resolvePaymentPricingSnapshot;
globalThis.__pricing = { INTRODUCTORY_ANNUAL_PRICE_CENTS, PRICING_CUTOFF_AT, PRICING_POLICY_VERSION, resolveCanaryPricing };
const { markCanaryPaymentPaid } = await import(`data:text/javascript;base64,${Buffer.from(testable).toString('base64')}`);

function adminFor(user, { onboarding = null, onboardingError = null, rpcResult = { ok: true, alreadyProcessed: false, onboardingUpdated: false, testPurchase: true }, rpcError = null } = {}) {
  const rpcCalls = [];
  const authUpdates = [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: onboarding, error: onboardingError }),
  };
  return {
    rpcCalls,
    authUpdates,
    auth: { admin: {
      getUserById: async () => ({ data: { user }, error: null }),
      updateUserById: async (_id, payload) => { authUpdates.push(payload); return { error: null }; },
    } },
    from: () => chain,
    rpc: async (name, params) => { rpcCalls.push({ name, params }); return { data: rpcResult, error: rpcError }; },
  };
}

function sessionFor({
  owner = 'user-1', district = 'district-1', includeCharge = true,
  paidAt = '2026-08-31T12:00:00-07:00', testPurchase = true,
  requestId = '', sessionId = 'cs_test_1', amount = testPurchase ? 100 : 149900,
} = {}) {
  const reason = testPurchase ? 'test-purchase' : 'pre_cutoff_introductory_rate';
  return {
    id: sessionId,
    mode: 'payment',
    status: 'complete',
    livemode: false,
    payment_status: 'paid',
    amount_total: amount,
    currency: 'usd',
    customer: {
      id: 'cus_test_1',
      email: 'test@district.org',
      metadata: { ...(owner ? { user_id: owner } : {}), ...(district !== null ? { district_id: district } : {}) },
    },
    payment_intent: { latest_charge: includeCharge ? { id: 'ch_1', created: Math.floor(Date.parse(paidAt) / 1000) } : 'ch_1' },
    metadata: {
      user_id: 'user-1',
      district_id: district ?? '',
      contact_email: 'test@district.org',
      canary_request_id: requestId,
      organization_name: 'District 1',
      canary_test_purchase: testPurchase ? 'true' : 'false',
      canary_amount_cents: String(amount),
      canary_renewal_amount_cents: String(amount),
      canary_currency: 'usd',
      canary_pricing_policy_version: testPurchase ? 'test-purchase' : '2026-09-01-v1',
      canary_pricing_reason: reason,
      canary_pricing_locked: 'false',
    },
  };
}

const existing = {
  is_test_account: true,
  district_id: 'district-1',
  payment_status: 'paid',
  payment_paid_at: '2026-08-01T00:00:00.000Z',
  paid_through: '2027-08-01T00:00:00.000Z',
  access_status: 'active',
  trial_status: 'converted',
  annual_price_cents: 149900,
  renewal_price_cents: 149900,
  stripe_customer_id: 'cus_test_1',
};
const user = { id: 'user-1', email: 'test@district.org', app_metadata: existing, user_metadata: { district_name: 'District 1' } };

const testAdmin = adminFor(user);
globalThis.__paymentStateAdmin = testAdmin;
const testResult = await markCanaryPaymentPaid({ session: sessionFor(), eventId: 'evt_test_1' });
assert.equal(testResult.ok, true);
assert.equal(testAdmin.rpcCalls.length, 1);
assert.equal(testAdmin.authUpdates.length, 0, 'payment-state must not perform non-transactional Auth writes');
assert.equal(testAdmin.rpcCalls[0].name, 'fulfill_canary_stripe_payment');
assert.equal(testAdmin.rpcCalls[0].params.p_stripe_event_id, 'evt_test_1');
assert.deepEqual(testAdmin.rpcCalls[0].params.p_expected_app_metadata, existing);
assert.equal(testAdmin.rpcCalls[0].params.p_app_patch.payment_status, undefined);
assert.equal(testAdmin.rpcCalls[0].params.p_app_patch.last_test_purchase_amount_cents, 100);

for (const [label, badSession, pattern] of [
  ['missing owner', sessionFor({ owner: '' }), /customer is not owned/],
  ['wrong district', sessionFor({ district: 'district-2' }), /district does not match/],
  ['missing customer district', sessionFor({ district: null }), /district does not match/],
  ['missing charge', sessionFor({ includeCharge: false }), /authoritative expanded charge timestamp/],
]) {
  const admin = adminFor(user);
  globalThis.__paymentStateAdmin = admin;
  await assert.rejects(() => markCanaryPaymentPaid({ session: badSession }), pattern, label);
  assert.equal(admin.rpcCalls.length, 0, `${label} must fail before mutation`);
}

const noDistrictUser = { ...user, app_metadata: { ...existing, district_id: '' } };
const noDistrictAdmin = adminFor(noDistrictUser);
globalThis.__paymentStateAdmin = noDistrictAdmin;
await assert.rejects(() => markCanaryPaymentPaid({ session: sessionFor({ district: '' }) }), /district does not match/);
assert.equal(noDistrictAdmin.rpcCalls.length, 0);

for (const [label, lifecyclePatch, pattern] of [
  ['wrong mode', { mode: 'subscription' }, /one-time payment/],
  ['incomplete session', { status: 'open' }, /one-time payment/],
  ['wrong livemode', { livemode: true }, /live\/test mode/],
]) {
  const admin = adminFor(user);
  globalThis.__paymentStateAdmin = admin;
  await assert.rejects(() => markCanaryPaymentPaid({ session: { ...sessionFor(), ...lifecyclePatch } }), pattern, label);
  assert.equal(admin.rpcCalls.length, 0, `${label} must fail before mutation`);
}

const repeatedAdmin = adminFor({ ...user, app_metadata: { ...existing, stripe_checkout_session_id: 'cs_repeat' } });
globalThis.__paymentStateAdmin = repeatedAdmin;
await assert.rejects(
  () => markCanaryPaymentPaid({ session: sessionFor({ testPurchase: false, sessionId: 'cs_repeat', paidAt: '2026-09-01T00:01:00-07:00' }) }),
  /introductory price expired/,
  'repeated-session cutoff validation must use the current expanded Charge, not stored payment_paid_at',
);
assert.equal(repeatedAdmin.rpcCalls.length, 0);

const onboarding = { id: 'req-1', contact_email: 'test@district.org', organization_name: 'District 1' };
const normalUser = { ...user, app_metadata: { district_id: 'district-1', stripe_customer_id: 'cus_test_1' } };
const normalAdmin = adminFor(normalUser, {
  onboarding,
  rpcResult: { ok: true, alreadyProcessed: false, onboardingUpdated: true, testPurchase: false, paidAt: '2026-08-31T19:00:00.000Z', paidThrough: '2027-08-31T19:00:00.000Z' },
});
globalThis.__paymentStateAdmin = normalAdmin;
const normalResult = await markCanaryPaymentPaid({ session: sessionFor({ testPurchase: false, requestId: 'req-1' }) });
assert.equal(normalResult.onboardingUpdated, true);
assert.equal(normalAdmin.rpcCalls.length, 1);
assert.equal(normalAdmin.authUpdates.length, 0);
assert.equal(normalAdmin.rpcCalls[0].params.p_request_id, 'req-1');
assert.deepEqual(normalAdmin.rpcCalls[0].params.p_expected_app_metadata, normalUser.app_metadata);

const legacySession = sessionFor({ testPurchase: false, sessionId: 'cs_legacy_1', paidAt: '2026-08-31T12:00:00-07:00' });
for (const key of ['canary_amount_cents', 'canary_renewal_amount_cents', 'canary_currency', 'canary_pricing_policy_version', 'canary_pricing_reason', 'canary_pricing_locked']) {
  delete legacySession.metadata[key];
}
const legacyAdmin = adminFor(normalUser, {
  rpcResult: { ok: true, alreadyProcessed: false, onboardingUpdated: false, testPurchase: false, paidAt: '2026-08-31T19:00:00.000Z', paidThrough: '2027-08-31T19:00:00.000Z' },
});
globalThis.__paymentStateAdmin = legacyAdmin;
await markCanaryPaymentPaid({ session: legacySession });
const legacyPatch = legacyAdmin.rpcCalls[0].params.p_app_patch;
assert.equal(legacyPatch.pricing_policy_version, PRICING_POLICY_VERSION);
assert.equal(legacyPatch.pricing_entitlement_reason, 'legacy_paid_customer_introductory_renewal');
const migratedLegacy = { ...normalUser.app_metadata, ...legacyPatch, payment_paid_at: '2026-08-31T19:00:00.000Z' };
const renewalPricing = resolveCanaryPricing({ protectedMetadata: migratedLegacy, now: new Date('2027-08-31T12:00:00-07:00') });
assert.equal(renewalPricing.policyVersion, PRICING_POLICY_VERSION);
assert.equal(renewalPricing.reason, 'legacy_paid_customer_introductory_renewal');
const secondPayment = resolvePaymentPricingSnapshot({
  id: 'cs_legacy_renewal', amount_total: 149900, currency: 'usd', metadata: {
    canary_amount_cents: '149900', canary_renewal_amount_cents: '149900', canary_currency: 'usd',
    canary_pricing_policy_version: renewalPricing.policyVersion, canary_pricing_reason: renewalPricing.reason,
    canary_pricing_locked: 'true', canary_pricing_locked_at: renewalPricing.lockedAt,
  },
}, { paidAt: '2027-08-31T12:00:00-07:00' });
assert.equal(secondPayment.paidAmountCents, 149900);

const mismatchAdmin = adminFor(normalUser, { onboarding: null });
globalThis.__paymentStateAdmin = mismatchAdmin;
await assert.rejects(() => markCanaryPaymentPaid({ session: sessionFor({ testPurchase: false, requestId: 'req-1' }) }), /onboarding request does not match/);
assert.equal(mismatchAdmin.rpcCalls.length, 0, 'onboarding ownership must validate before entitlement mutation');

const failedRpcAdmin = adminFor(normalUser, { onboarding, rpcResult: null, rpcError: { message: 'failed' } });
globalThis.__paymentStateAdmin = failedRpcAdmin;
await assert.rejects(() => markCanaryPaymentPaid({ session: sessionFor({ testPurchase: false, requestId: 'req-1' }) }), /atomically persist/);
assert.equal(failedRpcAdmin.authUpdates.length, 0);

console.log('Payment state transactional, timing, and ownership tests passed.');
