import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/app/api/stripe/webhook/route.js', import.meta.url), 'utf8');
const testable = source
  .replace("import { NextResponse } from 'next/server';", 'const NextResponse = globalThis.__webhook.NextResponse;')
  .replace("import { markCanaryPaymentPaid } from '@/lib/payment-state';", 'const markCanaryPaymentPaid = globalThis.__webhook.markCanaryPaymentPaid;')
  .replace("import { retrieveCheckoutSession } from '@/lib/stripe';", 'const retrieveCheckoutSession = globalThis.__webhook.retrieveCheckoutSession;')
  .replace("import { verifyStripeWebhookSignature } from '@/lib/stripe-webhook';", 'const verifyStripeWebhookSignature = globalThis.__webhook.verifyStripeWebhookSignature;');

let verifyError = null;
let fullSession = { id: 'cs_1', mode: 'payment', status: 'complete', livemode: false, payment_status: 'paid' };
let paidResult = { ok: true, alreadyProcessed: false };
let paidError = null;
const paidCalls = [];
globalThis.__webhook = {
  NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
  verifyStripeWebhookSignature: () => { if (verifyError) throw verifyError; return true; },
  retrieveCheckoutSession: async () => fullSession,
  markCanaryPaymentPaid: async (args) => { paidCalls.push(args); if (paidError) throw paidError; return paidResult; },
};
const { POST } = await import(`data:text/javascript;base64,${Buffer.from(testable).toString('base64')}`);
function request(event) {
  return {
    text: async () => typeof event === 'string' ? event : JSON.stringify(event),
    headers: { get: () => 'signature' },
  };
}

verifyError = new Error('bad');
let response = await POST(request({ id: 'evt_1' }));
assert.equal(response.status, 400);
verifyError = null;

response = await POST(request('{bad json'));
assert.equal(response.status, 400);

response = await POST(request({ id: 'evt_ignore', type: 'customer.updated', data: { object: {} } }));
assert.deepEqual(response.body, { received: true, handled: false });

response = await POST(request({ id: 'evt_unpaid', type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'unpaid' } } }));
assert.equal(response.body.reason, 'session_not_paid');

paidCalls.length = 0;
response = await POST(request({ id: 'evt_paid', type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid' } } }));
assert.equal(response.status, 200);
assert.equal(response.body.handled, true);
assert.equal(paidCalls.length, 1);
assert.equal(paidCalls[0].eventId, 'evt_paid');
assert.equal(paidCalls[0].session, fullSession);

paidResult = { ok: true, alreadyProcessed: true };
response = await POST(request({ id: 'evt_duplicate', type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid' } } }));
assert.equal(response.body.alreadyProcessed, true);

paidError = new Error('rpc down');
response = await POST(request({ id: 'evt_retry', type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid' } } }));
assert.equal(response.status, 500, 'transient reconciliation failures must be retried by Stripe');

console.log('Stripe webhook HTTP semantics and event-claim tests passed.');
