export const INTRODUCTORY_ANNUAL_PRICE_CENTS = 149900;
export const STANDARD_ANNUAL_PRICE_CENTS = 500000;
export const PRICING_CUTOFF_AT = '2026-09-01T00:00:00-07:00';
export const PRICING_POLICY_VERSION = '2026-09-01-v1';
export const NSPRA_2026_OFFER_CODE = 'nspra_2026';
export const NSPRA_2026_OFFER_EXPIRES_AT = '2026-10-01T00:00:00-07:00';

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

export function isValidNspraPoEntitlement(metadata = {}, { poNumber = null, eligibilityReference = null } = {}) {
  const lockedAtMs = timestamp(metadata.pricing_locked_at);
  const currentPoNumber = String(metadata.pricing_po_number || '').trim();
  const currentReference = String(metadata.pricing_offer_eligibility_reference || '').trim();
  return positiveInteger(metadata.annual_price_cents) === INTRODUCTORY_ANNUAL_PRICE_CENTS
    && positiveInteger(metadata.renewal_price_cents) === INTRODUCTORY_ANNUAL_PRICE_CENTS
    && metadata.pricing_policy_version === PRICING_POLICY_VERSION
    && metadata.pricing_entitlement_reason === 'nspra_2026_valid_po'
    && metadata.pricing_lock_status === 'approved'
    && metadata.pricing_lock_reason === 'nspra_2026_valid_po'
    && metadata.pricing_po_status === 'received'
    && currentPoNumber.length >= 2
    && (poNumber === null || currentPoNumber === poNumber)
    && metadata.pricing_offer_code === NSPRA_2026_OFFER_CODE
    && metadata.pricing_offer_status === 'qualified'
    && metadata.pricing_offer_source === 'nspra_2026_finite_list'
    && metadata.pricing_offer_expires_at === NSPRA_2026_OFFER_EXPIRES_AT
    && currentReference.length > 0
    && (eligibilityReference === null || currentReference === eligibilityReference)
    && lockedAtMs !== null
    && lockedAtMs < Date.parse(NSPRA_2026_OFFER_EXPIRES_AT);
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
    if (metadata.pricing_entitlement_reason === 'nspra_2026_valid_po') {
      if (!isValidNspraPoEntitlement(metadata)) throw new Error('This Canary account has an invalid protected NSPRA PO entitlement.');
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
      offerCode: metadata.pricing_offer_code || null,
      offerStatus: metadata.pricing_offer_status || null,
      offerSource: metadata.pricing_offer_source || null,
      expiresAt: metadata.pricing_offer_expires_at || null,
      eligibilityReference: metadata.pricing_offer_eligibility_reference || null,
      lockReason: metadata.pricing_lock_reason || null,
      poStatus: metadata.pricing_po_status || null,
      poNumber: metadata.pricing_po_number || null,
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

  const nspraOfferExpiresAt = metadata.pricing_offer_expires_at || null;
  const nspraOfferGrantedAt = metadata.pricing_offer_granted_at || null;
  const nspraOfferExpiresMs = timestamp(nspraOfferExpiresAt);
  const nspraOfferGrantedMs = timestamp(nspraOfferGrantedAt);
  const eligibleNspraOffer = metadata.pricing_offer_code === NSPRA_2026_OFFER_CODE
    && metadata.pricing_offer_status === 'eligible'
    && metadata.pricing_offer_source === 'nspra_2026_finite_list'
    && nspraOfferExpiresAt === NSPRA_2026_OFFER_EXPIRES_AT
    && nspraOfferExpiresMs !== null
    && nspraOfferGrantedMs !== null
    && nspraOfferGrantedMs < nspraOfferExpiresMs
    && effectiveNow < nspraOfferExpiresMs;
  if (eligibleNspraOffer) {
    return {
      amountCents: INTRODUCTORY_ANNUAL_PRICE_CENTS,
      renewalAmountCents: INTRODUCTORY_ANNUAL_PRICE_CENTS,
      currency: 'usd',
      policyVersion: PRICING_POLICY_VERSION,
      reason: 'nspra_2026_eligible_offer',
      locked: true,
      lockedAt: nspraOfferGrantedAt,
      expiresAt: nspraOfferExpiresAt,
      offerCode: NSPRA_2026_OFFER_CODE,
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
