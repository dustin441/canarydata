#!/usr/bin/env node
import assert from 'node:assert/strict';
import { isCanaryComplimentary, isCanaryPaymentCovered, resolveCanaryPaymentCoverage } from '../src/lib/payment-status.mjs';
import { buildBillingDocumentContext } from '../src/lib/billing-documents.js';

const now = new Date('2026-08-21T00:00:00Z');
assert.equal(isCanaryPaymentCovered('paid', null, now), true);
assert.equal(isCanaryPaymentCovered('paid', '2027-08-18T00:00:00Z', now), true);
assert.equal(isCanaryPaymentCovered('paid', '2026-08-20T00:00:00Z', now), false);
assert.equal(isCanaryPaymentCovered('complimentary', '2027-08-18T00:00:00Z', now), true);
assert.equal(isCanaryPaymentCovered('complimentary', '2026-08-20T00:00:00Z', now), false);
assert.equal(isCanaryPaymentCovered('complimentary', null, now), false);
assert.equal(isCanaryPaymentCovered('complimentary', 'not-a-date', now), false);
assert.equal(isCanaryPaymentCovered('pending'), false);
assert.equal(isCanaryPaymentCovered(null), false);
assert.equal(isCanaryComplimentary('complimentary'), true);
assert.equal(isCanaryComplimentary('paid'), false);

assert.deepEqual(resolveCanaryPaymentCoverage({
  protectedStatus: 'pending',
  protectedPaidThrough: null,
  onboardingStatus: 'complimentary',
  onboardingPaidThrough: '2027-08-18T00:00:00Z',
}, now), { paymentStatus: 'complimentary', paidThrough: '2027-08-18T00:00:00Z' });
assert.deepEqual(resolveCanaryPaymentCoverage({
  protectedStatus: 'paid',
  protectedPaidThrough: null,
  onboardingStatus: 'pending',
  onboardingPaidThrough: null,
}, now), { paymentStatus: 'paid', paidThrough: null });
assert.deepEqual(resolveCanaryPaymentCoverage({
  protectedStatus: 'complimentary',
  protectedPaidThrough: '2026-08-20T00:00:00Z',
  onboardingStatus: 'pending',
  onboardingPaidThrough: null,
}, now), { paymentStatus: 'complimentary', paidThrough: '2026-08-20T00:00:00Z' });

assert.throws(
  () => buildBillingDocumentContext({
    user: { email: 'complimentary@district.org', app_metadata: { payment_status: 'complimentary', paid_through: '2099-01-01T00:00:00Z' }, user_metadata: {} },
    districtId: 'complimentary-district',
    districtName: 'Complimentary District',
    email: 'complimentary@district.org',
    onboardingRequest: null,
  }),
  /unavailable for active complimentary accounts/,
);
assert.doesNotThrow(() => buildBillingDocumentContext({
  user: { email: 'expired@district.org', app_metadata: { payment_status: 'complimentary', paid_through: '2000-01-01T00:00:00Z' }, user_metadata: {} },
  districtId: 'expired-district',
  districtName: 'Expired District',
  email: 'expired@district.org',
  onboardingRequest: null,
}));

console.log('Canary payment-status tests passed');
