import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBillingDocumentContext } from '../src/lib/billing-documents.js';
import { getCanaryCheckoutAmountLabel, resolveCheckoutExpiration, resolveCheckoutLineItem } from '../src/lib/stripe.js';
import { resolvePaymentPricingSnapshot } from '../src/lib/payment-pricing.js';

const originalTestEmails = process.env.CANARY_TEST_PAYMENT_EMAILS;
process.env.CANARY_TEST_PAYMENT_EMAILS = 'pricing-test@canarydata.media';
try {
  const standard = resolveCheckoutLineItem('new@district.org', {}, new Date('2026-09-01T00:00:00-07:00'));
  assert.equal(standard.priceCents, 500000);
  assert.equal(standard.priceId, '', 'policy-managed checkout must use its resolved price snapshot, not one global Stripe Price ID');
  assert.equal(standard.amountLabel, '$5,000 annual access');
  assert.equal(standard.pricing.reason, 'post_cutoff_standard_rate');
  assert.equal(resolveCheckoutExpiration(standard, new Date('2026-09-01T00:00:00-07:00')), null);

  const paid = resolveCheckoutLineItem('paid@district.org', {
    payment_status: 'paid',
    payment_paid_at: '2026-08-20T12:00:00Z',
  }, new Date('2026-09-20T00:00:00-07:00'));
  assert.equal(paid.priceCents, 149900);
  assert.equal(paid.pricing.renewalAmountCents, 149900);
  assert.equal(getCanaryCheckoutAmountLabel('paid@district.org', {
    payment_status: 'paid',
    payment_paid_at: '2026-08-20T12:00:00Z',
  }, new Date('2026-09-20T00:00:00-07:00')), '$1,499 annual access');

  const expiringIntro = resolveCheckoutLineItem('new@district.org', {}, new Date('2026-08-31T12:00:00-07:00'));
  assert.equal(resolveCheckoutExpiration(expiringIntro, new Date('2026-08-31T12:00:00-07:00')), Date.parse('2026-09-01T00:00:00-07:00') / 1000);
  assert.throws(() => resolveCheckoutExpiration(expiringIntro, new Date('2026-08-31T23:40:00-07:00')), /temporarily unavailable/);
  assert.equal(resolveCheckoutExpiration(paid, new Date('2026-08-31T23:40:00-07:00')), null);

  assert.throws(() => resolveCheckoutLineItem('pricing-test@canarydata.media', {}, new Date('2026-09-20T00:00:00-07:00')), /not a protected Canary test account/);
  const test = resolveCheckoutLineItem('pricing-test@canarydata.media', { is_test_account: true }, new Date('2026-09-20T00:00:00-07:00'));
  assert.equal(test.priceCents, 100);
  assert.equal(test.isTestPurchase, true);

  const snapshot = resolvePaymentPricingSnapshot({
    id: 'cs_standard', amount_total: 500000, currency: 'usd', metadata: {
      canary_amount_cents: '500000', canary_renewal_amount_cents: '500000', canary_currency: 'usd',
      canary_pricing_policy_version: '2026-09-01-v1', canary_pricing_reason: 'post_cutoff_standard_rate', canary_pricing_locked: 'false',
    },
  }, { paidAt: '2026-09-01T01:00:00-07:00' });
  assert.equal(snapshot.paidAmountCents, 500000);
  assert.equal(snapshot.renewalAmountCents, 500000);
  assert.equal(snapshot.policyVersion, '2026-09-01-v1');

  assert.throws(() => resolvePaymentPricingSnapshot({
    id: 'cs_tampered_amount', amount_total: 149900, currency: 'usd', metadata: { canary_amount_cents: '500000', canary_currency: 'usd' },
  }, { paidAt: '2026-09-01T01:00:00-07:00' }), /amount does not match/);
  assert.throws(() => resolvePaymentPricingSnapshot({
    id: 'cs_tampered_currency', amount_total: 500000, currency: 'usd', metadata: { canary_amount_cents: '500000', canary_currency: 'eur' },
  }, { paidAt: '2026-09-01T01:00:00-07:00' }), /currency does not match/);
  assert.throws(() => resolvePaymentPricingSnapshot({
    id: 'cs_bad_renewal', amount_total: 149900, currency: 'usd', metadata: {
      canary_amount_cents: '149900', canary_renewal_amount_cents: '12345', canary_currency: 'usd',
      canary_pricing_policy_version: '2026-09-01-v1', canary_pricing_reason: 'commitment_po_in_process',
      canary_pricing_locked: 'true', canary_pricing_locked_at: '2026-08-31T12:00:00-07:00',
    },
  }, { paidAt: '2026-09-01T01:00:00-07:00' }), /unsupported Canary annual price/);
  assert.throws(() => resolvePaymentPricingSnapshot({
    id: 'cs_missing_renewal', amount_total: 500000, currency: 'usd', metadata: {
      canary_amount_cents: '500000', canary_currency: 'usd', canary_pricing_policy_version: '2026-09-01-v1', canary_pricing_reason: 'post_cutoff_standard_rate',
    },
  }, { paidAt: '2026-09-01T01:00:00-07:00' }), /incomplete Canary pricing snapshot/);
  assert.throws(() => resolvePaymentPricingSnapshot({
    id: 'cs_fractional', amount_total: 500000, currency: 'usd', metadata: {
      canary_amount_cents: '500000.5', canary_renewal_amount_cents: '500000', canary_currency: 'usd', canary_pricing_policy_version: '2026-09-01-v1', canary_pricing_reason: 'post_cutoff_standard_rate',
    },
  }, { paidAt: '2026-09-01T01:00:00-07:00' }), /invalid Canary amount snapshot/);
  assert.throws(() => resolvePaymentPricingSnapshot({
    id: 'cs_stale_intro', amount_total: 149900, currency: 'usd', metadata: {
      canary_amount_cents: '149900', canary_renewal_amount_cents: '149900', canary_currency: 'usd',
      canary_pricing_policy_version: '2026-09-01-v1', canary_pricing_reason: 'pre_cutoff_introductory_rate', canary_pricing_locked: 'false',
    },
  }, { paidAt: '2026-09-01T00:01:00-07:00' }), /introductory price expired/);

  const committedIntro = resolvePaymentPricingSnapshot({
    id: 'cs_committed_intro', amount_total: 149900, currency: 'usd', metadata: {
      canary_amount_cents: '149900', canary_renewal_amount_cents: '149900', canary_currency: 'usd',
      canary_pricing_policy_version: '2026-09-01-v1', canary_pricing_reason: 'commitment_po_in_process',
      canary_pricing_locked: 'true', canary_pricing_locked_at: '2026-08-31T12:00:00-07:00',
    },
  }, { paidAt: '2026-09-10T00:00:00-07:00' });
  assert.equal(committedIntro.paidAmountCents, 149900);

  assert.throws(() => resolvePaymentPricingSnapshot({
    id: 'cs_unversioned_late', amount_total: 149900, currency: 'usd', metadata: {},
  }, { paidAt: '2026-09-01T00:01:00-07:00' }), /expired unversioned/);
  const legacyPreCutoff = resolvePaymentPricingSnapshot({
    id: 'cs_unversioned_early', amount_total: 149900, currency: 'usd', metadata: {},
  }, { paidAt: '2026-08-31T23:59:00-07:00' });
  assert.equal(legacyPreCutoff.policyVersion, 'legacy-pre-cutoff-payment');

  const testSnapshot = resolvePaymentPricingSnapshot({
    id: 'cs_test', amount_total: 100, currency: 'usd', metadata: { canary_test_purchase: 'true', canary_amount_cents: '100' },
  });
  assert.equal(testSnapshot.isTestPurchase, true);

  const document = buildBillingDocumentContext({
    user: { app_metadata: { annual_price_cents: 149900, renewal_price_cents: 149900 }, user_metadata: {} },
    districtId: 'district-a', districtName: 'District A', email: 'billing@district.org', onboardingRequest: null,
  });
  assert.equal(document.amountCents, 149900);
  assert.equal(document.renewalAmountCents, 149900);
  assert.equal(document.pricingLocked, true);
  assert.equal(document.amountLabel, '$1,499.00');

  const files = {
    paymentActions: await readFile(new URL('../src/app/payment/actions.js', import.meta.url), 'utf8'),
    paymentState: await readFile(new URL('../src/lib/payment-state.js', import.meta.url), 'utf8'),
    paymentPricing: await readFile(new URL('../src/lib/payment-pricing.js', import.meta.url), 'utf8'),
    stripe: await readFile(new URL('../src/lib/stripe.js', import.meta.url), 'utf8'),
    dashboard: await readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8'),
    webhook: await readFile(new URL('../src/app/api/stripe/webhook/route.js', import.meta.url), 'utf8'),
  };
  assert.doesNotMatch(files.paymentActions, /amount_due_cents:\s*149900/);
  assert.match(files.paymentActions, /amount_due_cents:\s*context\.pricing\.amountCents/);
  assert.match(files.stripe, /metadata\[canary_amount_cents\]/);
  assert.match(files.stripe, /metadata\[canary_renewal_amount_cents\]/);
  assert.match(files.stripe, /metadata\[canary_pricing_policy_version\]/);
  assert.match(files.stripe, /metadata\[canary_pricing_locked\]/);
  assert.match(files.stripe, /ownerId !== expectedUserId/);
  assert.match(files.stripe, /Idempotency-Key/);
  assert.match(files.stripe, /payment_method_types\[0\]/);
  assert.doesNotMatch(files.stripe, /customer_creation/);
  assert.match(files.stripe, /metadata\[user_id\]/);
  assert.match(files.stripe, /expand\[\]=customer/);
  assert.match(files.paymentPricing, /expired unversioned Canary price/);
  assert.match(files.paymentState, /renewal_price_cents/);
  assert.match(files.paymentState, /pricing does not match the protected Canary account entitlement/);
  assert.match(files.paymentState, /does not have a protected pre-cutoff introductory entitlement/);
  assert.match(files.paymentState, /fulfill_canary_stripe_payment/);
  assert.doesNotMatch(files.paymentState, /updateUserById/);
  assert.doesNotMatch(files.paymentState, /session\.created/);
  assert.match(files.webhook, /retrieveCheckoutSession\(eventSession\.id\)/);
  assert.doesNotMatch(files.webhook, /event\.created/);
  assert.doesNotMatch(files.dashboard, /Annual access:\s*<strong[^>]*>\$1,499/);
  console.log('Pricing integration tests passed.');
} finally {
  if (originalTestEmails === undefined) delete process.env.CANARY_TEST_PAYMENT_EMAILS;
  else process.env.CANARY_TEST_PAYMENT_EMAILS = originalTestEmails;
}
