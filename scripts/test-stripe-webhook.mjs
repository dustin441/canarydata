import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/lib/stripe-webhook.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { verifyStripeWebhookSignature } = await import(moduleUrl);

const secret = 'unit-test-signing-secret';
const payload = JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed' });
const timestamp = 1_700_000_000;
const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
const header = `t=${timestamp},v1=${signature}`;
const now = timestamp * 1000;

assert.equal(verifyStripeWebhookSignature({ payload, signatureHeader: header, secret, now }), true);
assert.throws(
  () => verifyStripeWebhookSignature({ payload: `${payload} `, signatureHeader: header, secret, now }),
  /verification failed/,
);
assert.throws(
  () => verifyStripeWebhookSignature({ payload, signatureHeader: header, secret, now: now + 301_000 }),
  /outside the allowed tolerance/,
);
assert.throws(
  () => verifyStripeWebhookSignature({ payload, signatureHeader: 'bad', secret, now }),
  /malformed/,
);

console.log('Stripe webhook signature tests passed.');
