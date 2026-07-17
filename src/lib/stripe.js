import { billingDocumentNumbers } from './billing-documents';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || process.env.CANARY_STRIPE_SECRET_KEY || '';
}

function getAnnualPriceCents() {
  const configured = Number(process.env.CANARY_ANNUAL_PRICE_CENTS || process.env.STRIPE_CANARY_ANNUAL_PRICE_CENTS || 149900);
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 149900;
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

async function stripeRequest(path, { method = 'GET', body } = {}) {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    throw new Error('Stripe is not configured yet. Add STRIPE_SECRET_KEY before collecting payment.');
  }

  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
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

function resolveCheckoutLineItem(contactEmail) {
  if (isTestPaymentAccount(contactEmail)) {
    return {
      productName: process.env.CANARY_TEST_STRIPE_PRODUCT_NAME || 'Canary Data Test Purchase',
      priceCents: getTestPriceCents(),
      priceId: process.env.CANARY_TEST_STRIPE_PRICE_ID || '',
      amountLabel: '$1 test purchase',
      isTestPurchase: true,
    };
  }

  return {
    productName: process.env.CANARY_STRIPE_PRODUCT_NAME || 'Canary Data Annual Access',
    priceCents: getAnnualPriceCents(),
    priceId: process.env.CANARY_STRIPE_PRICE_ID || '',
    amountLabel: '$1,499 annual access',
    isTestPurchase: false,
  };
}

export function getCanaryCheckoutAmountLabel(contactEmail) {
  return resolveCheckoutLineItem(contactEmail).amountLabel;
}

function checkoutMetadataParams({ organizationName, contactEmail, requestId, districtId, userId, isTestPurchase }) {
  const numbers = billingDocumentNumbers({ districtId, email: contactEmail });
  return {
    'metadata[canary_request_id]': requestId || '',
    'metadata[district_id]': districtId || '',
    'metadata[user_id]': userId || '',
    'metadata[organization_name]': organizationName || '',
    'metadata[contact_email]': contactEmail || '',
    'metadata[canary_test_purchase]': isTestPurchase ? 'true' : 'false',
    'metadata[canary_estimate_number]': numbers.estimateNumber,
    'metadata[canary_invoice_number]': numbers.invoiceNumber,
    'metadata[canary_receipt_number]': numbers.receiptNumber,
    'payment_intent_data[metadata][canary_request_id]': requestId || '',
    'payment_intent_data[metadata][district_id]': districtId || '',
    'payment_intent_data[metadata][user_id]': userId || '',
    'payment_intent_data[metadata][organization_name]': organizationName || '',
    'payment_intent_data[metadata][contact_email]': contactEmail || '',
    'payment_intent_data[metadata][canary_test_purchase]': isTestPurchase ? 'true' : 'false',
    'payment_intent_data[metadata][canary_estimate_number]': numbers.estimateNumber,
    'payment_intent_data[metadata][canary_invoice_number]': numbers.invoiceNumber,
    'payment_intent_data[metadata][canary_receipt_number]': numbers.receiptNumber,
  };
}

function checkoutCustomerParams({ contactEmail, customerId }) {
  if (customerId) return { customer: customerId };
  return {
    customer_email: contactEmail,
    customer_creation: 'always',
  };
}

export async function createCanaryCheckoutSession({ organizationName, contactEmail, requestId, districtId, userId, customerId, origin }) {
  const cleanOrigin = String(origin || 'https://www.canarydata.media').replace(/\/$/, '');
  const lineItem = resolveCheckoutLineItem(contactEmail);

  return stripeRequest('/checkout/sessions', {
    method: 'POST',
    body: encodeForm({
      mode: 'payment',
      ...checkoutCustomerParams({ contactEmail, customerId }),
      success_url: `${cleanOrigin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cleanOrigin}/payment/cancel`,
      ...checkoutLineItemParams(lineItem),
      ...checkoutMetadataParams({
        organizationName,
        contactEmail,
        requestId,
        districtId,
        userId,
        isTestPurchase: lineItem.isTestPurchase,
      }),
    }),
  });
}

export async function createCanaryEmbeddedCheckoutSession({ organizationName, contactEmail, requestId, districtId, userId, customerId }) {
  const lineItem = resolveCheckoutLineItem(contactEmail);

  return stripeRequest('/checkout/sessions', {
    method: 'POST',
    body: encodeForm({
      mode: 'payment',
      ui_mode: 'embedded_page',
      redirect_on_completion: 'never',
      ...checkoutCustomerParams({ contactEmail, customerId }),
      ...checkoutLineItemParams(lineItem),
      ...checkoutMetadataParams({
        organizationName,
        contactEmail,
        requestId,
        districtId,
        userId,
        isTestPurchase: lineItem.isTestPurchase,
      }),
    }),
  });
}

export async function retrieveCheckoutSession(sessionId) {
  const encoded = encodeURIComponent(sessionId);
  return stripeRequest(`/checkout/sessions/${encoded}`);
}
