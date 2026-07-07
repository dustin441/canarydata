const STRIPE_API_BASE = 'https://api.stripe.com/v1';

function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || process.env.CANARY_STRIPE_SECRET_KEY || '';
}

function getAnnualPriceCents() {
  const configured = Number(process.env.CANARY_ANNUAL_PRICE_CENTS || process.env.STRIPE_CANARY_ANNUAL_PRICE_CENTS || 149900);
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 149900;
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

export async function createCanaryCheckoutSession({ organizationName, contactEmail, requestId, origin }) {
  const cleanOrigin = String(origin || 'https://www.canarydata.media').replace(/\/$/, '');
  const priceCents = getAnnualPriceCents();
  const productName = process.env.CANARY_STRIPE_PRODUCT_NAME || 'Canary Data Annual Access';

  return stripeRequest('/checkout/sessions', {
    method: 'POST',
    body: encodeForm({
      mode: 'payment',
      customer_email: contactEmail,
      success_url: `${cleanOrigin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cleanOrigin}/payment/cancel`,
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': process.env.CANARY_PAYMENT_CURRENCY || 'usd',
      'line_items[0][price_data][unit_amount]': priceCents,
      'line_items[0][price_data][product_data][name]': productName,
      'line_items[0][price_data][product_data][description]': 'Annual Canary Data access after approved trial/onboarding review.',
      'metadata[canary_request_id]': requestId || '',
      'metadata[organization_name]': organizationName || '',
      'metadata[contact_email]': contactEmail || '',
      'payment_intent_data[metadata][canary_request_id]': requestId || '',
      'payment_intent_data[metadata][organization_name]': organizationName || '',
      'payment_intent_data[metadata][contact_email]': contactEmail || '',
    }),
  });
}

export async function retrieveCheckoutSession(sessionId) {
  const encoded = encodeURIComponent(sessionId);
  return stripeRequest(`/checkout/sessions/${encoded}`);
}
