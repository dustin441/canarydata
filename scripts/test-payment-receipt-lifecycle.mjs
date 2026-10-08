import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBillingDocumentContext } from '../src/lib/billing-documents.js';

const migrationUrl = new URL('../supabase/migrations/20261008120000_canary_payment_receipts.sql', import.meta.url);
const migration = await readFile(migrationUrl, 'utf8');
assert.match(migration, /create table public\.canary_payment_receipts/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on public\.canary_payment_receipts from public, anon, authenticated/);
assert.match(migration, /grant select, insert on public\.canary_payment_receipts to service_role/);
assert.doesNotMatch(migration, /drop function if exists public\.fulfill_canary_stripe_payment/, 'rollout must preserve the prior fulfillment signature for in-flight deployments');
assert.match(migration, /receipt_number text not null unique/i);
assert.match(migration, /where stripe_charge_id is not null/);
assert.match(migration, /where stripe_checkout_session_id is not null/);
assert.match(migration, /insert into public\.canary_payment_receipts/);
assert.match(migration, /v_app ->> 'stripe_checkout_session_id' = p_checkout_session_id[\s\S]*Historical recovery of the same payment must not grant a second year/, 'historical receipt backfills must preserve the existing paid-through date');
assert.match(migration, /p_charge_paid_at < v_existing_paid_at[\s\S]*v_is_latest_payment := false/, 'an older distinct card payment must not replace newer payment metadata');
assert.match(migration, /if v_is_latest_payment then[\s\S]*v_app := v_app \|\| coalesce\(p_app_patch/, 'card session metadata patches must only apply to the latest payment');
assert.match(migration, /create or replace function public\.record_canary_manual_payment/);
assert.match(migration, /payment_method[\s\S]*in \('check', 'ach'\)/);
assert.match(migration, /v_effective_paid_through := greatest\(coalesce\(v_existing_paid_through, p_paid_through\), p_paid_through\)/, 'manual payment backfills must never shorten protected coverage');
assert.match(migration, /paid_through = greatest\(coalesce\(paid_through, p_paid_through\), p_paid_through\)/, 'manual payment backfills must never shorten onboarding coverage');
assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/);
assert.match(migration, /revoke all on function public\.record_canary_manual_payment/);
assert.match(migration, /grant execute on function public\.record_canary_manual_payment[\s\S]*to service_role/);
assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|execute)[\s\S]*to authenticated/);

const stripeSource = await readFile(new URL('../src/lib/stripe.js', import.meta.url), 'utf8');
assert.match(stripeSource, /payment_intent_data\[receipt_email\]/, 'Checkout must send the protected contact email to Stripe receipts');
assert.match(stripeSource, /expand\[\]=payment_intent\.latest_charge/, 'Checkout retrieval must expand the latest charge');
assert.match(stripeSource, /receiptBase && chargeId \? `\$\{receiptBase\}-\$\{chargeId\.toUpperCase\(\)\}`/, 'card receipt numbers must be unique to the immutable Stripe charge');

const billingSource = await readFile(new URL('../src/lib/billing.js', import.meta.url), 'utf8');
assert.match(billingSource, /from\(['"]canary_payment_receipts['"]\)/, 'billing context must load the canonical receipt table');
assert.match(billingSource, /eq\(['"]district_id['"], districtId\)/, 'receipt query must also be scoped to the protected district');
assert.doesNotMatch(billingSource, /eq\(['"]auth_user_id['"]/, 'all users in the same protected district account must share its receipt');

const receipt = {
  receipt_number: 'CD-RCPT-DIST1-2026', payment_method: 'card', amount_cents: 149900, currency: 'usd',
  paid_at: '2026-09-30T13:40:47.000Z', paid_through: '2027-09-30T13:40:47.000Z',
  billing_email: 'protected@district.org', organization_name: 'Historical District Name', district_id: 'district-1',
  stripe_receipt_url: 'https://pay.stripe.com/receipts/test', source: 'stripe_checkout', source_reference: 'cs_paid_1',
};
const paidUser = {
  id: 'user-1',
  email: 'protected@district.org',
  app_metadata: { district_id: 'district-1', payment_status: 'paid', annual_price_cents: 500000, payment_paid_at: '2026-10-01T00:00:00Z', paid_through: '2027-10-01T00:00:00Z' },
  user_metadata: { district_name: 'Current District Name' },
};
const billingContext = { user: paidUser, districtId: 'district-1', districtName: 'Current District Name', email: paidUser.email, receipt, pricing: { amountCents: 500000, renewalAmountCents: 500000, currency: 'usd', policyVersion: 'test-current', reason: 'current', locked: true, lockedAt: null } };
const canonical = buildBillingDocumentContext(billingContext, { documentType: 'receipt' });
assert.equal(canonical.amountCents, 149900, 'receipt amount must not use the current pricing resolver');
assert.equal(canonical.organizationName, 'Historical District Name');
assert.equal(canonical.paidAt, receipt.paid_at);
assert.equal(canonical.paidThrough, receipt.paid_through);
assert.equal(canonical.receiptNumber, receipt.receipt_number);
assert.equal(canonical.paymentMethod, 'card');
assert.equal(canonical.stripeReceiptUrl, receipt.stripe_receipt_url);
assert.equal(canonical.receiptSource, 'canonical');

const sharedDistrictUser = buildBillingDocumentContext({
  ...billingContext,
  user: { ...paidUser, id: 'second-user', app_metadata: { district_id: 'district-1', payment_status: 'pending' } },
}, { documentType: 'receipt' });
assert.equal(sharedDistrictUser.paymentStatus, 'paid', 'the canonical district receipt must be available to another protected user in the paid account');
assert.equal(sharedDistrictUser.amountCents, 149900);

const crossTenant = buildBillingDocumentContext({
  ...billingContext,
  receipt: { ...receipt, district_id: 'other-district', amount_cents: 1 },
}, { documentType: 'receipt' });
assert.equal(crossTenant.amountCents, 500000, 'a receipt outside the protected district scope must never render');
assert.equal(crossTenant.receiptSource, 'legacy_fallback');

const quote = buildBillingDocumentContext(billingContext, { documentType: 'quote' });
assert.equal(quote.amountCents, 500000, 'quotes and invoices must remain pricing based');
assert.equal(quote.organizationName, 'Current District Name');

const legacy = buildBillingDocumentContext({ ...billingContext, receipt: null }, { documentType: 'receipt' });
assert.equal(legacy.amountCents, 500000, 'legacy paid accounts retain the existing safe fallback');
assert.equal(legacy.receiptSource, 'legacy_fallback');
assert.equal(legacy.paymentStatus, 'paid');

const pageSource = await readFile(new URL('../src/app/billing/[documentType]/page.js', import.meta.url), 'utf8');
assert.match(pageSource, /buildBillingDocumentContext\(context, \{ documentType \}\)/);
assert.match(pageSource, /doc\.paymentMethod/);
assert.match(pageSource, /doc\.stripeReceiptUrl/);

const dashboardSource = await readFile(new URL('../src/app/dashboard/page.js', import.meta.url), 'utf8');
assert.match(dashboardSource, /billingContext\?\.receipt \? 'paid'/, 'the Billing section must expose a canonical district receipt even when an individual user lacks legacy payment metadata');
assert.match(dashboardSource, /\[\s*billingContext\?\.receipt\?\.paid_through,[\s\S]*billingContext\?\.user\?\.app_metadata\?\.paid_through,[\s\S]*billingContext\?\.onboardingRequest\?\.paid_through,[\s\S]*reduce/, 'dashboard coverage must use the greatest receipt, protected, or onboarding paid-through date');

console.log('Canonical payment receipt lifecycle tests passed.');
