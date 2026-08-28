import assert from 'node:assert/strict';

process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
process.env.CANARY_TEST_PAYMENT_EMAILS = '';
const calls = [];
const customer = {
  id: 'cus_owned_1',
  email: 'billing@district.org',
  metadata: { user_id: 'user-1', district_id: 'district-1' },
};
let savedCustomer = customer;
function response(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}
globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url).pathname;
  calls.push({ path, options, body: options.body ? Object.fromEntries(options.body.entries()) : {} });
  if (path === '/v1/customers' && options.method === 'POST') return response(savedCustomer);
  if (path === '/v1/customers/cus_owned_1' && (!options.method || options.method === 'GET')) return response(savedCustomer);
  if (path === '/v1/checkout/sessions' && options.method === 'POST') {
    return response({ id: 'cs_owned_1', url: 'https://checkout.stripe.com/test', expires_at: 1788300000 });
  }
  throw new Error(`Unexpected Stripe request: ${options.method || 'GET'} ${path}`);
};

const { ensureCanaryStripeCustomer, createCanaryCheckoutSession } = await import('../src/lib/stripe.js');
const owner = { contactEmail: 'billing@district.org', userId: 'user-1', districtId: 'district-1' };
const createdId = await ensureCanaryStripeCustomer(owner);
assert.equal(createdId, 'cus_owned_1');
assert.equal(calls[0].path, '/v1/customers');
assert.ok(calls[0].options.headers['Idempotency-Key']);
assert.equal(calls[0].body['metadata[user_id]'], 'user-1');
assert.equal(calls[0].body['metadata[district_id]'], 'district-1');
assert.equal(calls[1].path, '/v1/customers/cus_owned_1', 'new Customer ownership must be read back');

calls.length = 0;
await ensureCanaryStripeCustomer({ ...owner, customerId: 'cus_owned_1' });
assert.deepEqual(calls.map((call) => call.path), ['/v1/customers/cus_owned_1']);

savedCustomer = { ...customer, metadata: { user_id: 'user-1', district_id: 'other-district' } };
await assert.rejects(() => ensureCanaryStripeCustomer({ ...owner, customerId: 'cus_owned_1' }), /does not match/);
savedCustomer = customer;

calls.length = 0;
const session = await createCanaryCheckoutSession({
  organizationName: 'District 1', contactEmail: owner.contactEmail, requestId: 'req-1',
  districtId: owner.districtId, userId: owner.userId, customerId: 'cus_owned_1', protectedMetadata: {},
  origin: 'https://www.canarydata.media',
});
assert.equal(session.id, 'cs_owned_1');
const checkout = calls.find((call) => call.path === '/v1/checkout/sessions');
assert.ok(checkout.options.headers['Idempotency-Key'], 'Checkout Session creation must be idempotent');
assert.equal(checkout.body.customer, 'cus_owned_1');
assert.equal(checkout.body['payment_method_types[0]'], 'card');
assert.equal(checkout.body.customer_creation, undefined);
assert.equal(checkout.body.success_url, 'https://www.canarydata.media/payment/success?session_id={CHECKOUT_SESSION_ID}');
const initialCheckoutKey = checkout.options.headers['Idempotency-Key'];
calls.length = 0;
await createCanaryCheckoutSession({
  organizationName: 'District 1', contactEmail: owner.contactEmail, requestId: 'req-1',
  districtId: owner.districtId, userId: owner.userId, customerId: 'cus_owned_1', protectedMetadata: {},
  origin: 'https://www.canarydata.media', previousSessionId: 'cs_expired_1',
});
const replacementCheckout = calls.find((call) => call.path === '/v1/checkout/sessions');
assert.notEqual(replacementCheckout.options.headers['Idempotency-Key'], initialCheckoutKey, 'an expired pending Session must produce a fresh replacement key');

await assert.rejects(
  () => createCanaryCheckoutSession({ ...owner, contactEmail: owner.contactEmail, customerId: '', protectedMetadata: {}, origin: 'https://www.canarydata.media' }),
  /ownership is required/,
);

console.log('Stripe Customer lifecycle and Checkout idempotency tests passed.');
