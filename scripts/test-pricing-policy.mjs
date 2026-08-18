import assert from 'node:assert/strict';
import {
  INTRODUCTORY_ANNUAL_PRICE_CENTS,
  STANDARD_ANNUAL_PRICE_CENTS,
  PRICING_CUTOFF_AT,
  PRICING_POLICY_VERSION,
  formatAnnualPriceLabel,
  resolveCanaryPricing,
} from '../src/lib/pricing.js';

const before = new Date('2026-08-31T23:59:59-07:00');
const after = new Date('2026-09-01T00:00:00-07:00');

assert.equal(INTRODUCTORY_ANNUAL_PRICE_CENTS, 149900);
assert.equal(STANDARD_ANNUAL_PRICE_CENTS, 500000);
assert.equal(PRICING_CUTOFF_AT, '2026-09-01T00:00:00-07:00');
assert.equal(PRICING_POLICY_VERSION, '2026-09-01-v1');

assert.deepEqual(resolveCanaryPricing({ protectedMetadata: {}, now: before }), {
  amountCents: 149900,
  renewalAmountCents: 149900,
  currency: 'usd',
  policyVersion: PRICING_POLICY_VERSION,
  reason: 'pre_cutoff_introductory_rate',
  locked: false,
  lockedAt: null,
});
assert.equal(resolveCanaryPricing({ protectedMetadata: {}, now: after }).amountCents, 500000);
assert.equal(resolveCanaryPricing({ protectedMetadata: {}, now: after }).reason, 'post_cutoff_standard_rate');

const legacyPaid = resolveCanaryPricing({ protectedMetadata: { payment_status: 'paid', payment_paid_at: '2026-08-20T12:00:00Z' }, now: after });
assert.equal(legacyPaid.amountCents, 149900);
assert.equal(legacyPaid.renewalAmountCents, 149900);
assert.equal(legacyPaid.reason, 'paid_customer_introductory_renewal');
assert.equal(legacyPaid.locked, true);

const paidWithoutDate = resolveCanaryPricing({ protectedMetadata: { payment_status: 'paid' }, now: after });
assert.equal(paidWithoutDate.amountCents, 149900);
assert.equal(paidWithoutDate.reason, 'legacy_paid_customer_introductory_renewal');

const paidStandard = resolveCanaryPricing({ protectedMetadata: { payment_status: 'paid', annual_price_cents: 500000, renewal_price_cents: 500000 }, now: after });
assert.equal(paidStandard.amountCents, 500000);
assert.equal(paidStandard.renewalAmountCents, 500000);
assert.equal(paidStandard.reason, 'protected_account_entitlement');
assert.throws(() => resolveCanaryPricing({ protectedMetadata: { annual_price_cents: 12345, renewal_price_cents: 12345 }, now: after }), /unsupported protected pricing entitlement/);
assert.throws(() => resolveCanaryPricing({ protectedMetadata: { annual_price_cents: 149900 }, now: after }), /incomplete protected pricing entitlement/);
assert.throws(() => resolveCanaryPricing({ protectedMetadata: { annual_price_cents: 149900, renewal_price_cents: 500000 }, now: after }), /conflicting protected annual and renewal prices/);

const approvedPo = resolveCanaryPricing({ protectedMetadata: {
  pricing_lock_status: 'approved',
  pricing_lock_reason: 'commitment_po_in_process',
  pricing_po_status: 'in_process',
  pricing_locked_at: '2026-08-31T18:00:00-07:00',
}, now: after });
assert.equal(approvedPo.amountCents, 149900);
assert.equal(approvedPo.reason, 'commitment_po_in_process');
assert.equal(approvedPo.locked, true);

const latePo = resolveCanaryPricing({ protectedMetadata: {
  pricing_lock_status: 'approved',
  pricing_lock_reason: 'commitment_po_in_process',
  pricing_po_status: 'in_process',
  pricing_locked_at: '2026-09-01T00:00:01-07:00',
}, now: after });
assert.equal(latePo.amountCents, 500000);

const unapprovedPo = resolveCanaryPricing({ protectedMetadata: {
  pricing_lock_status: 'requested',
  pricing_lock_reason: 'commitment_po_in_process',
  pricing_po_status: 'in_process',
  pricing_locked_at: '2026-08-31T18:00:00-07:00',
}, now: after });
assert.equal(unapprovedPo.amountCents, 500000);

const commitmentWithoutPoStatus = resolveCanaryPricing({ protectedMetadata: {
  pricing_lock_status: 'approved',
  pricing_lock_reason: 'commitment_po_in_process',
  pricing_locked_at: '2026-08-31T18:00:00-07:00',
}, now: after });
assert.equal(commitmentWithoutPoStatus.amountCents, 500000);

const crossingTrial = resolveCanaryPricing({ protectedMetadata: {
  trial_starts_at: '2026-08-20T12:00:00Z',
  trial_ends_at: '2026-09-19T12:00:00Z',
  trial_status: 'active',
}, now: after });
assert.equal(crossingTrial.amountCents, 500000);
assert.equal(crossingTrial.reason, 'post_cutoff_standard_rate');

assert.equal(formatAnnualPriceLabel(149900), '$1,499 annual access');
assert.equal(formatAnnualPriceLabel(500000), '$5,000 annual access');

console.log('Pricing policy tests passed.');
