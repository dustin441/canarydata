import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const poSourceUrl = new URL('../src/lib/purchase-order.mjs', import.meta.url);
const billingOverviewUrl = new URL('../src/lib/admin-billing.mjs', import.meta.url);
const billingSourceUrl = new URL('../src/lib/admin-billing.js', import.meta.url);
const actionsSourceUrl = new URL('../src/app/actions.js', import.meta.url);
const { validatePurchaseOrder } = await import(poSourceUrl);
const { buildAdminBillingCsv, buildAdminBillingOverview, filterAdminBillingRows, mergeAdminBillingRecords } = await import(billingOverviewUrl);

for (const value of ['PO-2026-1042', 'FY26/PO 00481', '#A_19.7', '2026-00481']) {
  const result = validatePurchaseOrder(value);
  assert.equal(result.valid, true, `${value} should look like a usable district PO`);
  assert.equal(result.present, true);
}
for (const value of ['', '   ', 'N/A', 'none', 'Pending', 'T.B.D.', 'test', 'testing', 'sample', 'demo', 'A', '12', '0000', '00-00', 'PO@123', '<script>']) {
  assert.equal(validatePurchaseOrder(value).valid, false, `${value || '(blank)'} must be rejected`);
}
assert.equal(validatePurchaseOrder('  PO-42   2026  ').normalized, 'PO-42 2026');
assert.equal(validatePurchaseOrder(`PO-${'1'.repeat(78)}`).valid, false, 'PO numbers must be bounded');

const overview = buildAdminBillingOverview([
  {
    id: 'request-1', organization_name: 'Paid District', po_number: 'PO-10', payment_status: 'paid',
    trial_status: 'converted', access_status: 'active', trial_starts_at: '2026-07-01T00:00:00Z',
    trial_ends_at: '2026-08-01T00:00:00Z', paid_at: '2026-07-20T00:00:00Z', paid_through: '2027-07-20T00:00:00Z',
    _stripePaymentConfirmed: true, contact_email: 'finance@paid.example', created_at: '2026-06-20T00:00:00Z',
  },
  {
    id: 'request-2', organization_name: 'Trial District', po_number: null, payment_status: 'pending',
    trial_status: 'active', access_status: 'active', trial_starts_at: '2026-08-20T00:00:00Z',
    trial_ends_at: '2026-09-15T00:00:00Z', paid_at: null, paid_through: null,
  },
  {
    id: 'request-3', organization_name: 'Placeholder District', po_number: 'TBD', payment_status: 'pending',
    trial_status: 'not_started', access_status: 'pending_setup', trial_starts_at: null,
    trial_ends_at: null, paid_at: null, paid_through: null,
  },
  {
    id: 'request-4', organization_name: 'Shelby County School District', po_number: null, payment_status: 'paid',
    trial_status: 'converted', access_status: 'manual_hold', paid_at: '2026-07-28T16:30:36Z',
    paid_through: '2027-07-28T16:30:36Z', updated_at: '2026-09-10T00:00:00Z',
    confirmed_profile: {
      sales_attribution: { owner: 'Cindy Warner', commission_eligible: true },
      follow_up: { owner: 'Lesley Bruinton' },
      billing_payment: { method: 'check', status: 'deposited', deposited_at: '2026-07-28T16:30:36Z', verified_by: 'admin-user' },
    },
    contact_email: '=formula@district.example',
  },
], new Date('2026-09-02T00:00:00Z'));

assert.deepEqual(overview.summary, {
  organizations: 4,
  paid: 2,
  paymentPending: 2,
  poValid: 1,
  poMissing: 2,
  poInvalid: 1,
  activeTrials: 1,
  activeAccess: 2,
  followUp: 2,
});
assert.equal(overview.rows[0].poState, 'valid');
assert.equal(overview.rows[1].poState, 'missing');
assert.equal(overview.rows[2].poState, 'invalid');
assert.equal('poNumber' in overview.rows[0], false, 'central view must not expose raw PO numbers');
assert.equal(JSON.stringify(overview).includes('PO-10'), false, 'central view must not serialize raw PO values');
const shelby = overview.rows.find((row) => row.id === 'request-4');
assert.equal(shelby.salesAttributionOwner, 'Cindy Warner');
assert.equal(shelby.commissionEligible, true);
assert.equal(shelby.followUpReason, 'Manual access decision');
assert.equal(shelby.followUpOwner, 'Lesley Bruinton');
assert.equal(shelby.paymentMethod, 'check');
assert.equal(overview.rows[0].paymentMethod, 'stripe_card');
assert.equal(overview.rows[2].paymentMethod, 'unknown');
assert.equal(overview.rows[2].paymentStatus, 'pending');
assert.equal(overview.rows[0].contactEmail, 'finance@paid.example', 'contact email belongs in the protected admin payload');
assert.equal(shelby.expectedUpdatedAt, '2026-09-10T00:00:00Z');
assert.deepEqual(filterAdminBillingRows(overview.rows, { searchTerm: 'shelby', statusFilter: 'all' }).map((row) => row.id), ['request-4']);
assert.deepEqual(filterAdminBillingRows(overview.rows, { searchTerm: '', statusFilter: 'commission' }).map((row) => row.id), ['request-4']);
assert.deepEqual(filterAdminBillingRows(overview.rows, { searchTerm: '', statusFilter: 'follow_up' }).map((row) => row.id).sort(), ['request-3', 'request-4']);
assert.deepEqual(filterAdminBillingRows(overview.rows, { searchTerm: 'formula@district', statusFilter: 'all' }).map((row) => row.id), ['request-4']);
const csv = buildAdminBillingCsv(filterAdminBillingRows(overview.rows, { searchTerm: 'district', statusFilter: 'paid' }));
assert.match(csv, /Organization,Contact Email,Payment Status,Payment Method/);
assert.match(csv, /Paid District,finance@paid\.example,paid,Stripe\/card/);
assert.match(csv, /Shelby County School District,'=formula@district\.example,paid,Check/);
assert.match(csv, /Lesley Bruinton/);
assert.doesNotMatch(csv, /PO-10|PO-99/, 'CSV must keep raw PO values excluded');

const merged = mergeAdminBillingRecords([
  { id: 'request-1', organization_name: 'Request Name', contact_email: 'hidden@district.org', po_number: null, payment_status: 'pending' },
  { id: 'stale-request', organization_name: 'Stale Dates District', contact_email: 'stale@district.org', payment_status: 'paid', paid_at: '2026-01-01T00:00:00Z', paid_through: '2027-01-01T00:00:00Z' },
], [
  { id: 'user-1', email: 'hidden@district.org', app_metadata: { district_id: 'district-1', payment_status: 'paid', payment_paid_at: '2026-08-20T00:00:00Z', paid_through: '2027-08-20T00:00:00Z', stripe_checkout_session_id: 'cs_paid_1', access_status: 'active' }, user_metadata: { district_name: 'Protected District', po_number: 'PO-99' } },
  { id: 'legacy-user', email: 'legacy@district.org', app_metadata: { district_id: 'legacy-district', payment_status: 'paid', trial_status: 'active', access_status: 'active', paid_through: '2027-09-01T00:00:00Z' }, user_metadata: { district_name: 'Legacy District' } },
  { id: 'legacy-user-2', email: 'colleague@district.org', app_metadata: { district_id: 'legacy-district', payment_status: 'pending', trial_status: 'expired', access_status: 'expired' }, user_metadata: { district_name: 'Legacy District' } },
  { id: 'stale-user', email: 'stale@district.org', app_metadata: { district_id: 'stale-district', payment_status: 'pending', payment_paid_at: null, paid_through: null }, user_metadata: { district_name: 'Stale Dates District' } },
  { id: 'admin-user', email: 'admin@canary.test', app_metadata: { role: 'admin', payment_status: 'paid' }, user_metadata: {} },
  { id: 'reviewer-user', email: 'reviewer@canary.test', app_metadata: { role: 'demo_reviewer', district_id: 'review-district', payment_status: 'paid' }, user_metadata: {} },
  { id: 'test-user', email: 'test@canary.test', app_metadata: { district_id: 'test-district', is_test_account: true }, user_metadata: {} },
]);
assert.equal(merged.length, 3, 'request-linked and legacy client accounts should be visible without admin/test/reviewer accounts');
const mergedOverview = buildAdminBillingOverview(merged);
assert.equal(mergedOverview.rows.find((row) => row.id === 'request-1').paymentStatus, 'paid', 'fresh protected payment state must override stale request state');
assert.equal(mergedOverview.rows.find((row) => row.id === 'request-1').paymentMethod, 'stripe_card');
assert.equal(mergedOverview.rows.find((row) => row.id === 'request-1').contactEmail, 'hidden@district.org');
assert.equal(mergedOverview.rows.find((row) => row.id === 'request-1').poState, 'valid');
const legacyRow = mergedOverview.rows.find((row) => row.id === 'district:legacy-district');
assert.ok(legacyRow, 'legacy accounts without onboarding rows must remain centrally visible by protected district identity');
assert.equal(legacyRow.paymentStatus, 'verification_needed', 'paid without Stripe fulfillment or verified deposited-check evidence must not be presented as confirmed paid');
assert.equal(legacyRow.paymentMethod, 'unknown');
assert.equal(legacyRow.accessStatus, 'active', 'multiple profiles must preserve active organization access');
assert.equal(legacyRow.paidThrough, null, 'unverified paid coverage dates must not be presented as confirmed');
const staleRow = mergedOverview.rows.find((row) => row.id === 'stale-request');
assert.equal(staleRow.paymentStatus, 'pending');
assert.equal(staleRow.paidAt, null, 'protected pending state must clear stale onboarding paid date');
assert.equal(staleRow.paidThrough, null, 'protected pending state must clear stale onboarding coverage date');
assert.equal(JSON.stringify(mergedOverview).includes('hidden@district.org'), true, 'protected admin payload must include contact email for export');
assert.equal(JSON.stringify(mergedOverview).includes('PO-99'), false, 'central payload must not expose auth PO values');

const adminBillingSource = await readFile(billingSourceUrl, 'utf8');
assert.match(adminBillingSource, /freshUserResult\?\.user\?\.app_metadata\?\.role !== 'admin'/, 'billing read must authorize from freshly loaded protected metadata');
assert.match(adminBillingSource, /status = 403/, 'non-admin reads must be forbidden server-side');
assert.match(adminBillingSource, /\.from\('onboarding_requests'\)/);
assert.match(adminBillingSource, /contact_email/, 'server-side email reconciliation should merge legacy request/account links');
assert.match(adminBillingSource, /confirmed_profile/, 'server-side billing read should load protected attribution metadata');
assert.match(adminBillingSource, /listUsers\(\{ page, perPage \}\)/, 'legacy and protected Auth billing state must be loaded with pagination');
const actionsSource = await readFile(actionsSourceUrl, 'utf8');
assert.match(actionsSource, /export async function updateAdminBillingAttribution/);
assert.match(actionsSource, /assertCanaryReviewer\(actor\)/, 'billing attribution mutation must require a protected admin');
assert.match(actionsSource, /\.eq\('updated_at', expectedUpdatedAt\)/, 'billing attribution mutation must be concurrency guarded');
assert.match(actionsSource, /owner\.length > 120/, 'billing attribution owner must be bounded');
assert.match(actionsSource, /followUpOwner\.length > 120/, 'follow-up owner must be bounded');
assert.match(actionsSource, /follow_up:/, 'follow-up owner must be persisted in protected profile context');

const dashboardPage = await readFile(new URL('../src/app/dashboard/page.js', import.meta.url), 'utf8');
assert.match(dashboardPage, /isAdmin \? loadDashboardDataset\('Billing pipeline'/, 'only protected admins may trigger the cross-district billing read');
assert.match(dashboardPage, /requestedView !== 'billing' \|\| isAdmin/, 'non-admin direct billing routes must fall back before rendering');
const dashboardClient = await readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
assert.match(dashboardClient, /Admin billing & projections/);
assert.match(dashboardClient, /PO status/);
assert.match(dashboardClient, /Payment method/);
assert.match(dashboardClient, /Follow-up owner/);
assert.match(dashboardClient, /Export filtered CSV/);
assert.match(dashboardClient, /Paid means a confirmed Stripe payment or a verified deposited check/);
assert.doesNotMatch(dashboardClient, /billingRow\.poNumber/, 'UI must not render raw PO numbers');

console.log('Admin billing authorization, PO validation, and projection-summary tests passed.');
