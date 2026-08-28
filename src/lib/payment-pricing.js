import {
  INTRODUCTORY_ANNUAL_PRICE_CENTS,
  PRICING_CUTOFF_AT,
  PRICING_POLICY_VERSION,
  NSPRA_2026_OFFER_EXPIRES_AT,
  STANDARD_ANNUAL_PRICE_CENTS,
  isValidNspraPoEntitlement,
} from './pricing.js';

const ALLOWED_ANNUAL_PRICES = new Set([INTRODUCTORY_ANNUAL_PRICE_CENTS, STANDARD_ANNUAL_PRICE_CENTS]);
const INTRODUCTORY_REASONS_ALLOWED_AFTER_CUTOFF = new Set([
  'commitment_po_in_process',
  'paid_customer_introductory_renewal',
  'legacy_paid_customer_introductory_renewal',
  'protected_account_entitlement',
  'nspra_2026_eligible_offer',
  'nspra_2026_valid_po',
]);

function strictPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolvePaymentPricingSnapshot(session, { paidAt } = {}) {
  const metadata = session?.metadata || {};
  const isTestPurchase = metadata.canary_test_purchase === 'true';
  const policyVersion = String(metadata.canary_pricing_policy_version || '');
  const reason = String(metadata.canary_pricing_reason || '');
  const metadataAmountPresent = hasValue(metadata.canary_amount_cents);
  const renewalPresent = hasValue(metadata.canary_renewal_amount_cents);
  const metadataCurrencyPresent = hasValue(metadata.canary_currency);
  const metadataAmountCents = strictPositiveInteger(metadata.canary_amount_cents);
  const renewalSnapshotCents = strictPositiveInteger(metadata.canary_renewal_amount_cents);
  const sessionAmountCents = strictPositiveInteger(session?.amount_total);

  if (metadataAmountPresent && metadataAmountCents === null) {
    throw new Error(`Stripe session ${session?.id || 'unknown'} has an invalid Canary amount snapshot.`);
  }
  if (renewalPresent && renewalSnapshotCents === null) {
    throw new Error(`Stripe session ${session?.id || 'unknown'} has an invalid Canary renewal snapshot.`);
  }
  if (hasValue(session?.amount_total) && sessionAmountCents === null) {
    throw new Error(`Stripe session ${session?.id || 'unknown'} has an invalid paid amount.`);
  }
  if (metadataAmountCents && sessionAmountCents && metadataAmountCents !== sessionAmountCents) {
    throw new Error(`Stripe session ${session?.id || 'unknown'} amount does not match its Canary pricing snapshot.`);
  }

  const paidAmountCents = metadataAmountCents || sessionAmountCents;
  const paidCurrency = String(metadata.canary_currency || session?.currency || 'usd').toLowerCase();
  if (session?.currency && String(session.currency).toLowerCase() !== paidCurrency) {
    throw new Error(`Stripe session ${session?.id || 'unknown'} currency does not match its Canary pricing snapshot.`);
  }
  if (!paidAmountCents) {
    throw new Error(`Stripe session ${session?.id || 'unknown'} is missing its Canary pricing snapshot.`);
  }

  if (isTestPurchase) {
    return {
      isTestPurchase,
      paidAmountCents,
      paidCurrency,
      renewalAmountCents: renewalSnapshotCents || paidAmountCents,
      policyVersion,
      reason,
      locked: metadata.canary_pricing_locked === 'true',
      lockedAt: metadata.canary_pricing_locked_at || null,
    };
  }

  if (policyVersion && (!metadataAmountPresent || !renewalPresent || !metadataCurrencyPresent || !reason)) {
    throw new Error(`Stripe session ${session?.id || 'unknown'} has an incomplete Canary pricing snapshot.`);
  }

  const renewalAmountCents = renewalSnapshotCents || paidAmountCents;
  const locked = metadata.canary_pricing_locked === 'true';
  const lockedAt = metadata.canary_pricing_locked_at || null;
  const expiresAt = metadata.canary_pricing_expires_at || null;
  if (paidCurrency !== 'usd') {
    throw new Error(`Stripe session ${session?.id || 'unknown'} uses an unsupported Canary billing currency.`);
  }
  if (!ALLOWED_ANNUAL_PRICES.has(paidAmountCents) || !ALLOWED_ANNUAL_PRICES.has(renewalAmountCents)) {
    throw new Error(`Stripe session ${session?.id || 'unknown'} contains an unsupported Canary annual price.`);
  }
  if (renewalAmountCents !== paidAmountCents) {
    throw new Error(`Stripe session ${session?.id || 'unknown'} renewal price does not match its paid annual price.`);
  }

  const paidAtMs = timestamp(paidAt);
  if (paidAtMs === null) {
    throw new Error(`Stripe session ${session?.id || 'unknown'} is missing an authoritative payment timestamp.`);
  }
  const cutoffMs = Date.parse(PRICING_CUTOFF_AT);

  if (!policyVersion) {
    if (paidAtMs >= cutoffMs || paidAmountCents !== INTRODUCTORY_ANNUAL_PRICE_CENTS) {
      throw new Error(`Stripe session ${session?.id || 'unknown'} has an expired unversioned Canary price.`);
    }
    return {
      isTestPurchase,
      paidAmountCents,
      paidCurrency,
      renewalAmountCents,
      policyVersion: 'legacy-pre-cutoff-payment',
      reason: 'legacy_pre_cutoff_payment',
      locked: true,
      lockedAt: new Date(paidAtMs).toISOString(),
    };
  }

  if (policyVersion !== PRICING_POLICY_VERSION) {
    throw new Error(`Stripe session ${session?.id || 'unknown'} uses an unsupported Canary pricing policy.`);
  }

  if (reason === 'nspra_2026_valid_po') {
    const validSnapshot = isValidNspraPoEntitlement({
      annual_price_cents: paidAmountCents,
      renewal_price_cents: renewalAmountCents,
      pricing_policy_version: policyVersion,
      pricing_entitlement_reason: reason,
      pricing_lock_status: locked ? 'approved' : '',
      pricing_lock_reason: metadata.canary_pricing_lock_reason,
      pricing_po_status: metadata.canary_pricing_po_status,
      pricing_po_number: metadata.canary_pricing_po_number,
      pricing_locked_at: lockedAt,
      pricing_offer_code: metadata.canary_pricing_offer_code,
      pricing_offer_status: metadata.canary_pricing_offer_status,
      pricing_offer_source: metadata.canary_pricing_offer_source,
      pricing_offer_expires_at: expiresAt,
      pricing_offer_eligibility_reference: metadata.canary_pricing_eligibility_reference,
    });
    if (!validSnapshot) {
      throw new Error(`Stripe session ${session?.id || 'unknown'} is missing a valid pre-deadline NSPRA PO lock.`);
    }
  }

  if (paidAmountCents === INTRODUCTORY_ANNUAL_PRICE_CENTS && paidAtMs >= cutoffMs) {
    if (!locked || !INTRODUCTORY_REASONS_ALLOWED_AFTER_CUTOFF.has(reason)) {
      throw new Error(`Stripe session ${session?.id || 'unknown'} introductory price expired before payment.`);
    }
    if (reason === 'commitment_po_in_process') {
      const lockedAtMs = timestamp(lockedAt);
      if (lockedAtMs === null || lockedAtMs >= cutoffMs) {
        throw new Error(`Stripe session ${session?.id || 'unknown'} is missing a valid pre-cutoff commitment lock.`);
      }
    }

    if (reason === 'nspra_2026_eligible_offer') {
      const expiresAtMs = timestamp(expiresAt);
      if (expiresAt !== NSPRA_2026_OFFER_EXPIRES_AT || expiresAtMs === null || paidAtMs >= expiresAtMs) {
        throw new Error(`Stripe session ${session?.id || 'unknown'} NSPRA offer expired before payment.`);
      }
    }
  }

  if (paidAmountCents === STANDARD_ANNUAL_PRICE_CENTS && reason === 'pre_cutoff_introductory_rate') {
    throw new Error(`Stripe session ${session?.id || 'unknown'} price conflicts with its Canary pricing reason.`);
  }

  return { isTestPurchase, paidAmountCents, paidCurrency, renewalAmountCents, policyVersion, reason, locked, lockedAt, expiresAt };
}
