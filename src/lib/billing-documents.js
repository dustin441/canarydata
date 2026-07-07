const ANNUAL_PRICE_CENTS = 149900;

export function formatCurrency(cents = ANNUAL_PRICE_CENTS) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatDate(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function billingAccountCode(districtId, email) {
  const seed = String(districtId || email || 'CANARY').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return (seed || 'CANARY').slice(0, 8);
}

export function billingDocumentNumbers({ districtId, email, year = new Date().getFullYear() } = {}) {
  const accountCode = billingAccountCode(districtId, email);
  return {
    quoteNumber: `CD-Q-${accountCode}-${year}`,
    invoiceNumber: `CD-INV-${accountCode}-${year}`,
    receiptNumber: `CD-RCPT-${accountCode}-${year}`,
  };
}

export function buildBillingDocumentContext({ user, districtId, districtName, email, onboardingRequest }) {
  const metadata = user?.user_metadata || {};
  const issuedAt = new Date();
  const dueAt = addDays(issuedAt, 30);
  const numbers = billingDocumentNumbers({ districtId, email });
  const poNumber = metadata.po_number || onboardingRequest?.po_number || '';
  const paymentStatus = metadata.payment_status || onboardingRequest?.payment_status || 'pending';
  const paidAt = metadata.payment_paid_at || onboardingRequest?.paid_at || null;

  return {
    organizationName: districtName || onboardingRequest?.organization_name || metadata.district_name || 'School District',
    districtId: districtId || metadata.district_id || '',
    billingEmail: email || onboardingRequest?.contact_email || user?.email || '',
    billingContactName: metadata.billing_contact_name || onboardingRequest?.contact_name || '',
    poNumber,
    quoteNumber: metadata.quote_number || numbers.quoteNumber,
    invoiceNumber: metadata.invoice_number || numbers.invoiceNumber,
    receiptNumber: metadata.receipt_number || numbers.receiptNumber,
    issuedAt,
    dueAt,
    trialStartsAt: metadata.trial_starts_at || onboardingRequest?.trial_starts_at || null,
    trialEndsAt: metadata.trial_ends_at || onboardingRequest?.trial_ends_at || null,
    paymentStatus,
    paidAt,
    paidThrough: metadata.paid_through || onboardingRequest?.paid_through || null,
    amountCents: ANNUAL_PRICE_CENTS,
    amountLabel: formatCurrency(ANNUAL_PRICE_CENTS),
    netTerms: 'Net 30',
  };
}

export const BILLING_DOCUMENT_COPY = {
  quote: {
    title: 'Canary Data Quote',
    label: 'Quote',
    statusLabel: 'Quote for approval',
    intro: 'This quote outlines annual Canary Data platform access after the approved 30-day trial period.',
  },
  'purchase-order': {
    title: 'Canary Data Purchase Order / Invoice',
    label: 'Purchase Order / Invoice',
    statusLabel: 'Payment pending',
    intro: 'This purchase order/invoice may be used for district approval and payment processing. Payment terms are Net 30 from the purchase order/invoice issue date.',
  },
  receipt: {
    title: 'Canary Data Receipt',
    label: 'Receipt',
    statusLabel: 'Paid receipt',
    intro: 'This receipt confirms payment for annual Canary Data platform access.',
  },
};
