function validFutureDate(value, now) {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed > now;
}

export function isCanaryPaymentCovered(status, paidThrough, now = new Date()) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'paid') return true;
  return normalized === 'complimentary' && validFutureDate(paidThrough, now);
}

export function isCanaryComplimentary(status) {
  return String(status || '').toLowerCase() === 'complimentary';
}

export function resolveCanaryPaymentCoverage({
  protectedStatus,
  protectedPaidThrough,
  onboardingStatus,
  onboardingPaidThrough,
}, now = new Date()) {
  if (isCanaryPaymentCovered(protectedStatus, protectedPaidThrough, now)) {
    return { paymentStatus: protectedStatus, paidThrough: protectedPaidThrough || null };
  }
  if (isCanaryPaymentCovered(onboardingStatus, onboardingPaidThrough, now)) {
    return { paymentStatus: onboardingStatus, paidThrough: onboardingPaidThrough || null };
  }
  return {
    paymentStatus: protectedStatus || onboardingStatus || 'pending',
    paidThrough: protectedPaidThrough || onboardingPaidThrough || null,
  };
}
