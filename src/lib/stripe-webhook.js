import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TOLERANCE_SECONDS = 300;

function parseSignatureHeader(header) {
  return String(header || '')
    .split(',')
    .map((part) => part.trim().split('='))
    .reduce((result, [key, value]) => {
      if (!key || !value) return result;
      if (!result[key]) result[key] = [];
      result[key].push(value);
      return result;
    }, {});
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyStripeWebhookSignature({ payload, signatureHeader, secret, now = Date.now(), toleranceSeconds = DEFAULT_TOLERANCE_SECONDS }) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');

  const parsed = parseSignatureHeader(signatureHeader);
  const timestamp = Number(parsed.t?.[0]);
  const signatures = parsed.v1 || [];
  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new Error('Stripe signature header is malformed.');
  }

  const ageSeconds = Math.abs(Math.floor(now / 1000) - timestamp);
  if (ageSeconds > toleranceSeconds) {
    throw new Error('Stripe signature timestamp is outside the allowed tolerance.');
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  if (!signatures.some((signature) => secureEqual(signature, expected))) {
    throw new Error('Stripe webhook signature verification failed.');
  }

  return true;
}
