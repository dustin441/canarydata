import { createHash } from 'node:crypto';
import { billingDocumentNumbers } from './billing-documents.js';
import { formatAnnualPriceLabel, INTRODUCTORY_ANNUAL_PRICE_CENTS, PRICING_CUTOFF_AT, resolveCanaryPricing } from './pricing.js';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || process.env.CANARY_STRIPE_SECRET_KEY || '';
}

function getTestPriceCents() {
  const configured = Number(process.env.CANARY_TEST_PRICE_CENTS || 100);
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 100;
}

function isTestPaymentAccount(contactEmail) {
  const email = String(contactEmail || '').trim().toLowerCase();
  if (!email) return false;
  return String(process.env.CANARY_TEST_PAYMENT_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);
}

function encodeForm(params) {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') body.append(key, String(value));
  });
  return body;
}

async function stripeRequest(path, { method = 'GET', body, idempotencyKey } = {}) {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    throw new Error('Stripe is not configured yet. Add STRIPE_SECRET_KEY before collecting payment.');
  }

  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body,
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Stripe returned ${response.status}`);
  }
  return payload;
}

function stableStripeKey(prefix, parts) {
  const digest = createHash('sha256').update(parts.map((part) => String(part || '')).join('\u001f')).digest('hex');
  return `canary-${prefix}-${digest}`;
}

function checkoutLineItemParams({ productName, priceCents, priceId }) {
  if (priceId) {
    return {
      'line_items[0][quantity]': 1,
      'line_items[0][price]': priceId,
    };
  }

  return {
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': process.env.CANARY_PAYMENT_CURRENCY || 'usd',
    'line_items[0][price_data][unit_amount]': priceCents,
    'line_items[0][price_data][product_data][name]': productName,
    'line_items[0][price_data][product_data][description]': 'Annual Canary Data platform access, including monitoring, reporting, AI-assisted summaries, and exports.',
  };
}

export function resolveCheckoutLineItem(contactEmail, protectedMetadata = {}, now = new Date()) {
  if (isTestPaymentAccount(contactEmail)) {
    if (protectedMetadata?.is_test_account !== true) {
      throw new Error('This configured test-payment email is not a protected Canary test account.');
    }
    return {
      productName: process.env.CANARY_TEST_STRIPE_PRODUCT_NAME || 'Canary Data Test Purchase',
      priceCents: getTestPriceCents(),
      priceId: process.env.CANARY_TEST_STRIPE_PRICE_ID || '',
      amountLabel: '$1 test purchase',
      isTestPurchase: true,
    };
  }

  const pricing = resolveCanaryPricing({ protectedMetadata, now });
  return {
    productName: process.env.CANARY_STRIPE_PRODUCT_NAME || 'Canary Data Annual Access',
    priceCents: pricing.amountCents,
    priceId: '',
    amountLabel: formatAnnualPriceLabel(pricing.amountCents),
    isTestPurchase: false,
    pricing,
  };
}

export function getCanaryCheckoutAmountLabel(contactEmail, protectedMetadata = {}, now = new Date()) {
  return resolveCheckoutLineItem(contactEmail, protectedMetadata, now).amountLabel;
}

export function resolveCheckoutExpiration(lineItem, now = new Date()) {
  if (lineItem.isTestPurchase || lineItem.priceCents !== INTRODUCTORY_ANNUAL_PRICE_CENTS) return null;
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const pricingDeadline = lineItem.pricing?.expiresAt || (lineItem.pricing?.locked ? null : PRICING_CUTOFF_AT);
  if (!pricingDeadline) return null;
  const cutoffMs = Date.parse(pricingDeadline);
  const remainingMs = cutoffMs - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  if (remainingMs < 30 * 60 * 1000) {
    throw new Error('Card checkout is temporarily unavailable during this pricing deadline. Contact Canary to complete payment before the deadline.');
  }
  if (remainingMs <= 24 * 60 * 60 * 1000) return Math.floor(cutoffMs / 1000);
  return null;
}

function checkoutMetadataParams({ organizationName, contactEmail, requestId, districtId, userId, lineItem }) {
  const numbers = billingDocumentNumbers({ districtId, email: contactEmail });
  const pricing = lineItem.pricing || {};
  return {
    'metadata[canary_request_id]': requestId || '',
    'metadata[district_id]': districtId,
    'metadata[user_id]': userId,
    'metadata[organization_name]': organizationName || '',
    'metadata[contact_email]': contactEmail,
    'metadata[canary_test_purchase]': lineItem.isTestPurchase ? 'true' : 'false',
    'metadata[canary_amount_cents]': lineItem.priceCents,
    'metadata[canary_renewal_amount_cents]': pricing.renewalAmountCents || lineItem.priceCents,
    'metadata[canary_currency]': pricing.currency || process.env.CANARY_PAYMENT_CURRENCY || 'usd',
    'metadata[canary_pricing_policy_version]': pricing.policyVersion || 'test-purchase',
    'metadata[canary_pricing_reason]': pricing.reason || 'test-purchase',
    'metadata[canary_pricing_locked]': pricing.locked ? 'true' : 'false',
    'metadata[canary_pricing_locked_at]': pricing.lockedAt || '',
    'metadata[canary_pricing_expires_at]': pricing.expiresAt || '',
    'metadata[canary_pricing_offer_code]': pricing.offerCode || '',
    'metadata[canary_pricing_offer_status]': pricing.offerStatus || '',
    'metadata[canary_pricing_offer_source]': pricing.offerSource || '',
    'metadata[canary_pricing_eligibility_reference]': pricing.eligibilityReference || '',
    'metadata[canary_pricing_lock_reason]': pricing.lockReason || '',
    'metadata[canary_pricing_po_status]': pricing.poStatus || '',
    'metadata[canary_pricing_po_number]': pricing.poNumber || '',
    'metadata[canary_estimate_number]': numbers.estimateNumber,
    'metadata[canary_invoice_number]': numbers.invoiceNumber,
    'metadata[canary_receipt_number]': numbers.receiptNumber,
    'payment_intent_data[metadata][canary_request_id]': requestId || '',
    'payment_intent_data[metadata][district_id]': districtId,
    'payment_intent_data[metadata][user_id]': userId,
    'payment_intent_data[metadata][organization_name]': organizationName || '',
    'payment_intent_data[metadata][contact_email]': contactEmail,
    'payment_intent_data[metadata][canary_test_purchase]': lineItem.isTestPurchase ? 'true' : 'false',
    'payment_intent_data[metadata][canary_amount_cents]': lineItem.priceCents,
    'payment_intent_data[metadata][canary_renewal_amount_cents]': pricing.renewalAmountCents || lineItem.priceCents,
    'payment_intent_data[metadata][canary_currency]': pricing.currency || process.env.CANARY_PAYMENT_CURRENCY || 'usd',
    'payment_intent_data[metadata][canary_pricing_policy_version]': pricing.policyVersion || 'test-purchase',
    'payment_intent_data[metadata][canary_pricing_reason]': pricing.reason || 'test-purchase',
    'payment_intent_data[metadata][canary_pricing_locked]': pricing.locked ? 'true' : 'false',
    'payment_intent_data[metadata][canary_pricing_locked_at]': pricing.lockedAt || '',
    'payment_intent_data[metadata][canary_pricing_expires_at]': pricing.expiresAt || '',
    'payment_intent_data[metadata][canary_pricing_offer_code]': pricing.offerCode || '',
    'payment_intent_data[metadata][canary_pricing_offer_status]': pricing.offerStatus || '',
    'payment_intent_data[metadata][canary_pricing_offer_source]': pricing.offerSource || '',
    'payment_intent_data[metadata][canary_pricing_eligibility_reference]': pricing.eligibilityReference || '',
    'payment_intent_data[metadata][canary_pricing_lock_reason]': pricing.lockReason || '',
    'payment_intent_data[metadata][canary_pricing_po_status]': pricing.poStatus || '',
    'payment_intent_data[metadata][canary_pricing_po_number]': pricing.poNumber || '',
    'payment_intent_data[metadata][canary_estimate_number]': numbers.estimateNumber,
    'payment_intent_data[metadata][canary_invoice_number]': numbers.invoiceNumber,
    'payment_intent_data[metadata][canary_receipt_number]': numbers.receiptNumber,
  };
}

function assertCustomerOwnership(customer, { contactEmail, userId, districtId }) {
  const expectedEmail = String(contactEmail || '').trim().toLowerCase();
  const expectedUserId = String(userId || '');
  const expectedDistrictId = String(districtId || '');
  const customerEmail = String(customer?.email || '').trim().toLowerCase();
  const ownerId = String(customer?.metadata?.user_id || '');
  const ownerDistrictId = String(customer?.metadata?.district_id || '');
  if (customer?.deleted || !expectedEmail || !expectedUserId || !expectedDistrictId
    || customerEmail !== expectedEmail || ownerId !== expectedUserId || ownerDistrictId !== expectedDistrictId) {
    throw new Error('The Stripe customer does not match this protected Canary account.');
  }
  return customer;
}

export async function ensureCanaryStripeCustomer({ contactEmail, customerId, userId, districtId }) {
  const expectedEmail = String(contactEmail || '').trim().toLowerCase();
  const expectedUserId = String(userId || '');
  const expectedDistrictId = String(districtId || '');
  if (!expectedEmail || !expectedUserId || !expectedDistrictId) {
    throw new Error('A protected Canary user, billing email, and district are required before creating Stripe checkout.');
  }

  let resolvedCustomerId = String(customerId || '');
  if (!resolvedCustomerId) {
    const created = await stripeRequest('/customers', {
      method: 'POST',
      idempotencyKey: stableStripeKey('customer-v1', [expectedUserId, expectedDistrictId, expectedEmail]),
      body: encodeForm({
        email: expectedEmail,
        'metadata[user_id]': expectedUserId,
        'metadata[district_id]': expectedDistrictId,
      }),
    });
    resolvedCustomerId = String(created?.id || '');
    if (!resolvedCustomerId) throw new Error('Stripe did not return a Customer for this Canary account.');
  }

  const readback = await stripeRequest(`/customers/${encodeURIComponent(resolvedCustomerId)}`);
  assertCustomerOwnership(readback, { contactEmail: expectedEmail, userId: expectedUserId, districtId: expectedDistrictId });
  return resolvedCustomerId;
}

function checkoutIdempotencyKey(mode, { userId, districtId, customerId, lineItem, previousSessionId = '' }) {
  return stableStripeKey(`checkout-${mode}-v1`, [
    userId,
    districtId,
    customerId,
    lineItem.priceCents,
    lineItem.pricing?.policyVersion || 'test-purchase',
    lineItem.pricing?.reason || 'test-purchase',
    previousSessionId || 'initial',
  ]);
}

export async function createCanaryCheckoutSession({ organizationName, contactEmail, requestId, districtId, userId, customerId, protectedMetadata = {}, origin, previousSessionId = '' }) {
  if (!customerId || !districtId || !userId) throw new Error('Protected Canary Customer ownership is required before Checkout.');
  const cleanOrigin = String(origin || 'https://www.canarydata.media').replace(/\/$/, '');
  const now = new Date();
  const lineItem = resolveCheckoutLineItem(contactEmail, protectedMetadata, now);
  const expiresAt = resolveCheckoutExpiration(lineItem, now);
  await ensureCanaryStripeCustomer({ contactEmail, customerId, userId, districtId });

  return stripeRequest('/checkout/sessions', {
    method: 'POST',
    idempotencyKey: checkoutIdempotencyKey('hosted', { userId, districtId, customerId, lineItem, previousSessionId }),
    body: encodeForm({
      mode: 'payment',
      customer: customerId,
      'payment_method_types[0]': 'card',
      success_url: `${cleanOrigin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cleanOrigin}/payment/cancel`,
      expires_at: expiresAt,
      ...checkoutLineItemParams(lineItem),
      ...checkoutMetadataParams({ organizationName, contactEmail, requestId, districtId, userId, lineItem }),
    }),
  });
}

export async function createCanaryEmbeddedCheckoutSession({ organizationName, contactEmail, requestId, districtId, userId, customerId, protectedMetadata = {}, previousSessionId = '' }) {
  if (!customerId || !districtId || !userId) throw new Error('Protected Canary Customer ownership is required before Checkout.');
  const now = new Date();
  const lineItem = resolveCheckoutLineItem(contactEmail, protectedMetadata, now);
  const expiresAt = resolveCheckoutExpiration(lineItem, now);
  await ensureCanaryStripeCustomer({ contactEmail, customerId, userId, districtId });

  return stripeRequest('/checkout/sessions', {
    method: 'POST',
    idempotencyKey: checkoutIdempotencyKey('embedded', { userId, districtId, customerId, lineItem, previousSessionId }),
    body: encodeForm({
      mode: 'payment',
      ui_mode: 'embedded_page',
      redirect_on_completion: 'never',
      customer: customerId,
      'payment_method_types[0]': 'card',
      expires_at: expiresAt,
      ...checkoutLineItemParams(lineItem),
      ...checkoutMetadataParams({ organizationName, contactEmail, requestId, districtId, userId, lineItem }),
    }),
  });
}

export async function retrieveCheckoutSession(sessionId) {
  const encoded = encodeURIComponent(sessionId);
  return stripeRequest(`/checkout/sessions/${encoded}?expand[]=customer&expand[]=payment_intent.latest_charge`);
}
