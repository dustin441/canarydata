import { isCanaryPaymentCovered, resolveCanaryPaymentCoverage } from './payment-status.mjs';

const TRIAL_FROZEN_ACCESS_STATUSES = new Set(['inactive', 'frozen', 'inactive_frozen', 'suspended', 'suspended_unpaid']);
const HARD_DENY_ACCESS_STATUSES = new Set(['revoked', 'disabled', 'suspended_security', 'terminated']);

export function isCanaryAccountHardDenied(metadata = {}) {
  const accessStatus = String(metadata.access_status || '').toLowerCase();
  return metadata.account_enabled === false || HARD_DENY_ACCESS_STATUSES.has(accessStatus);
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveCanaryTrialAccess({ protectedMetadata = {}, onboardingRequest = null, now = new Date() } = {}) {
  const metadata = protectedMetadata || {};
  const request = onboardingRequest || {};
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const accessStatus = String(metadata.access_status || request.access_status || '').toLowerCase();
  const trialStatus = String(metadata.trial_status || request.trial_status || '').toLowerCase();
  const trialEndsAt = metadata.trial_ends_at || request.trial_ends_at || null;
  const trialEndsMs = timestamp(trialEndsAt);
  const nowMs = effectiveNow.getTime();

  if (isCanaryAccountHardDenied(metadata) || isCanaryAccountHardDenied(request)) {
    return { allowed: false, state: 'revoked', reason: 'account_revoked', trialEndsAt };
  }

  const coverage = resolveCanaryPaymentCoverage({
    protectedStatus: metadata.payment_status,
    protectedPaidThrough: metadata.paid_through,
    onboardingStatus: request.payment_status,
    onboardingPaidThrough: request.paid_through,
  }, effectiveNow);
  if (isCanaryPaymentCovered(coverage.paymentStatus, coverage.paidThrough, effectiveNow)) {
    return { allowed: true, state: 'active', reason: 'payment_covered', trialEndsAt };
  }

  const paymentStatus = String(coverage.paymentStatus || '').toLowerCase();
  const paidThroughMs = timestamp(coverage.paidThrough);
  if ((paymentStatus === 'paid' || paymentStatus === 'complimentary') && coverage.paidThrough && (paidThroughMs === null || paidThroughMs <= nowMs)) {
    return { allowed: false, state: 'inactive_frozen', reason: 'payment_coverage_expired', trialEndsAt };
  }

  // Trial-frozen markers only have trial semantics when an explicit trial end exists.
  // This preserves access for legacy provisioned clients that predate trial lifecycle metadata.
  if (trialEndsMs !== null && (TRIAL_FROZEN_ACCESS_STATUSES.has(accessStatus) || trialStatus === 'expired')) {
    return { allowed: false, state: 'inactive_frozen', reason: 'protected_frozen_status', trialEndsAt };
  }
  if (trialEndsMs !== null && Number.isFinite(nowMs) && nowMs >= trialEndsMs) {
    return { allowed: false, state: 'inactive_frozen', reason: 'trial_expired_unpaid', trialEndsAt };
  }
  return { allowed: true, state: 'active', reason: 'trial_or_legacy_access', trialEndsAt };
}
