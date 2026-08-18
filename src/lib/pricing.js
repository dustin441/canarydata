export const INTRODUCTORY_ANNUAL_PRICE_CENTS = 149900;
export const STANDARD_ANNUAL_PRICE_CENTS = 500000;
export const PRICING_CUTOFF_AT = '2026-09-01T00:00:00-07:00';
export const PRICING_POLICY_VERSION = '2026-09-01-v1';

const PRICING_CUTOFF_MS = Date.parse(PRICING_CUTOFF_AT);
const SUPPORTED_ANNUAL_PRICES = new Set([INTRODUCTORY_ANNUAL_PRICE_CENTS, STANDARD_ANNUAL_PRICE_CENTS]);

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatAnnualPriceLabel(amountCents) {
  const amount = positiveInteger(amountCents) || 0;
  const currency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount / 100);
  return `${currency} annual access`;
}

export function resolveCanaryPricing({ protectedMetadata = {}, now = new Date() } = {}) {
  const metadata = protectedMetadata || {};
  const nowMs = now instanceof Date ? now.getTime() : timestamp(now);
  const effectiveNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const explicitAnnual = positiveInteger(metadata.annual_price_cents);
  const explicitRenewal = positiveInteger(metadata.renewal_price_cents);
  const lockedAt = metadata.pricing_locked_at || null;

  if (explicitAnnual || explicitRenewal) {
    if (!explicitAnnual || !explicitRenewal) {
      throw new Error('This Canary account has an incomplete protected pricing entitlement.');
    }
    if ((explicitAnnual && !SUPPORTED_ANNUAL_PRICES.has(explicitAnnual))
      || (explicitRenewal && !SUPPORTED_ANNUAL_PRICES.has(explicitRenewal))) {
      throw new Error('This Canary account has an unsupported protected pricing entitlement.');
    }
    if (explicitAnnual && explicitRenewal && explicitAnnual !== explicitRenewal) {
      throw new Error('This Canary account has conflicting protected annual and renewal prices.');
    }
    const amountCents = explicitAnnual;
    return {
      amountCents,
      renewalAmountCents: explicitRenewal || amountCents,
      currency: 'usd',
      policyVersion: metadata.pricing_policy_version || PRICING_POLICY_VERSION,
      reason: metadata.pricing_entitlement_reason || 'protected_account_entitlement',
      locked: true,
      lockedAt,
    };
  }

  if (metadata.payment_status === 'paid') {
    const paidAt = timestamp(metadata.payment_paid_at || metadata.paid_at);
    const paidAtIntroductory = paidAt === null || paidAt < PRICING_CUTOFF_MS;
    const amountCents = paidAtIntroductory
      ? INTRODUCTORY_ANNUAL_PRICE_CENTS
      : STANDARD_ANNUAL_PRICE_CENTS;
    return {
      amountCents,
      renewalAmountCents: amountCents,
      currency: 'usd',
      policyVersion: PRICING_POLICY_VERSION,
      reason: paidAt === null
        ? 'legacy_paid_customer_introductory_renewal'
        : paidAtIntroductory
          ? 'paid_customer_introductory_renewal'
          : 'paid_customer_standard_renewal',
      locked: true,
      lockedAt: metadata.payment_paid_at || metadata.paid_at || null,
    };
  }

  const lockTime = timestamp(lockedAt);
  const approvedCommitmentPo = metadata.pricing_lock_status === 'approved'
    && metadata.pricing_lock_reason === 'commitment_po_in_process'
    && metadata.pricing_po_status === 'in_process'
    && lockTime !== null
    && lockTime < PRICING_CUTOFF_MS;
  if (approvedCommitmentPo) {
    return {
      amountCents: INTRODUCTORY_ANNUAL_PRICE_CENTS,
      renewalAmountCents: INTRODUCTORY_ANNUAL_PRICE_CENTS,
      currency: 'usd',
      policyVersion: PRICING_POLICY_VERSION,
      reason: 'commitment_po_in_process',
      locked: true,
      lockedAt,
    };
  }

  const preCutoff = effectiveNow < PRICING_CUTOFF_MS;
  const amountCents = preCutoff
    ? INTRODUCTORY_ANNUAL_PRICE_CENTS
    : STANDARD_ANNUAL_PRICE_CENTS;
  return {
    amountCents,
    renewalAmountCents: amountCents,
    currency: 'usd',
    policyVersion: PRICING_POLICY_VERSION,
    reason: preCutoff ? 'pre_cutoff_introductory_rate' : 'post_cutoff_standard_rate',
    locked: false,
    lockedAt: null,
  };
}
