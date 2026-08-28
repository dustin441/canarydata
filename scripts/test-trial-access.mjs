import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveCanaryTrialAccess } from '../src/lib/trial-access.mjs';
import { loadCanaryAccountAccess, requireCanaryAccountAccess } from '../src/lib/account-access.js';

const beforeEnd = new Date('2026-08-30T11:59:59Z');
const atEnd = new Date('2026-08-30T12:00:00Z');
const baseTrial = {
  district_id: 'district-1', payment_status: 'pending', access_status: 'active', trial_status: 'active',
  trial_starts_at: '2026-07-31T12:00:00Z', trial_ends_at: '2026-08-30T12:00:00Z',
};

assert.equal(resolveCanaryTrialAccess({ protectedMetadata: baseTrial, now: beforeEnd }).allowed, true);
const expired = resolveCanaryTrialAccess({ protectedMetadata: baseTrial, now: atEnd });
assert.equal(expired.allowed, false);
assert.equal(expired.state, 'inactive_frozen');
assert.equal(expired.reason, 'trial_expired_unpaid');

for (const accessStatus of ['inactive', 'frozen', 'inactive_frozen', 'suspended', 'suspended_unpaid']) {
  const result = resolveCanaryTrialAccess({ protectedMetadata: { ...baseTrial, access_status: accessStatus }, now: beforeEnd });
  assert.equal(result.allowed, false, `${accessStatus} must block dashboard access`);
}
assert.equal(resolveCanaryTrialAccess({ protectedMetadata: { ...baseTrial, trial_status: 'expired' }, now: beforeEnd }).allowed, false);

const paid = resolveCanaryTrialAccess({ protectedMetadata: { ...baseTrial, payment_status: 'paid', access_status: 'inactive_frozen', trial_status: 'expired' }, now: atEnd });
assert.equal(paid.allowed, true, 'legacy paid state without paid_through must override a stale frozen trial marker');
const currentPaid = resolveCanaryTrialAccess({ protectedMetadata: { ...baseTrial, payment_status: 'paid', paid_through: '2027-08-30T12:00:00Z' }, now: atEnd });
assert.equal(currentPaid.allowed, true);
const expiredPaid = resolveCanaryTrialAccess({ protectedMetadata: { ...baseTrial, payment_status: 'paid', paid_through: '2026-08-30T11:59:59Z' }, now: atEnd });
assert.equal(expiredPaid.allowed, false, 'annual paid access with an expired paid_through must be denied');
assert.equal(expiredPaid.reason, 'payment_coverage_expired');
const complimentary = resolveCanaryTrialAccess({ protectedMetadata: {
  ...baseTrial, payment_status: 'complimentary', paid_through: '2026-12-31T00:00:00Z', access_status: 'inactive_frozen', trial_status: 'expired',
}, now: atEnd });
assert.equal(complimentary.allowed, true, 'active complimentary access must override a stale frozen marker');
const expiredComplimentary = resolveCanaryTrialAccess({ protectedMetadata: {
  ...baseTrial, payment_status: 'complimentary', paid_through: '2026-08-01T00:00:00Z',
}, now: atEnd });
assert.equal(expiredComplimentary.allowed, false);

const onboardingOnly = resolveCanaryTrialAccess({
  protectedMetadata: { district_id: 'district-1' },
  onboardingRequest: { payment_status: 'pending', access_status: 'active', trial_status: 'active', trial_ends_at: '2026-08-30T12:00:00Z' },
  now: atEnd,
});
assert.equal(onboardingOnly.allowed, false);
for (const accessStatus of ['inactive_frozen', 'suspended_unpaid']) {
  assert.equal(resolveCanaryTrialAccess({ protectedMetadata: { district_id: 'legacy', access_status: accessStatus }, now: atEnd }).allowed, true, 'legacy trial marker without a trial date must not revoke access');
}
assert.equal(resolveCanaryTrialAccess({ protectedMetadata: { district_id: 'legacy', trial_status: 'expired' }, now: atEnd }).allowed, true);
assert.equal(resolveCanaryTrialAccess({ protectedMetadata: { district_id: 'legacy' }, now: atEnd }).allowed, true, 'legacy provisioned clients without trial dates retain current access');
for (const accessStatus of ['revoked', 'disabled', 'suspended_security', 'terminated']) {
  const revoked = resolveCanaryTrialAccess({ protectedMetadata: { district_id: 'district-1', payment_status: 'paid', access_status: accessStatus }, now: atEnd });
  assert.equal(revoked.allowed, false, `${accessStatus} must override paid access`);
  assert.equal(revoked.reason, 'account_revoked');
}
assert.equal(resolveCanaryTrialAccess({ protectedMetadata: { district_id: 'district-1', payment_status: 'paid', account_enabled: false }, now: atEnd }).allowed, false);

let onboardingQueries = 0;
const admin = {
  from: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: async () => { onboardingQueries += 1; return { data: [{ trial_status: 'active', access_status: 'active', payment_status: 'pending', trial_ends_at: '2026-08-30T12:00:00Z' }], error: null }; },
    };
    return chain;
  },
};
const fallbackAccess = await loadCanaryAccountAccess({ user: { email: 'client@district.org', app_metadata: { district_id: 'district-1' } }, admin, now: atEnd });
assert.equal(fallbackAccess.allowed, false);
assert.equal(onboardingQueries, 1);
await assert.rejects(() => requireCanaryAccountAccess({ user: { email: 'client@district.org', app_metadata: { district_id: 'district-1' } }, admin, now: atEnd }), (error) => error.code === 'CANARY_ACCESS_ENDED' && error.status === 403);
const protectedAccess = await loadCanaryAccountAccess({ user: { email: 'client@district.org', app_metadata: baseTrial }, admin, now: beforeEnd });
assert.equal(protectedAccess.allowed, true);
assert.equal(onboardingQueries, 3, 'protected lifecycle data must still union onboarding hard-deny state');
const partialLifecycle = await loadCanaryAccountAccess({ user: { email: 'client@district.org', app_metadata: { district_id: 'district-1', access_status: 'active' } }, admin, now: atEnd });
assert.equal(partialLifecycle.allowed, false, 'partial protected metadata must merge an unambiguous expired onboarding lifecycle');
assert.equal(onboardingQueries, 4);
assert.equal(resolveCanaryTrialAccess({ protectedMetadata: { access_status: 'active' }, onboardingRequest: { access_status: 'revoked' }, now: beforeEnd }).reason, 'account_revoked');
for (const role of ['admin', 'demo_reviewer']) {
  const privilegedRevoked = await loadCanaryAccountAccess({ user: { email: 'reviewer@canarydata.media', app_metadata: { role, access_status: 'revoked', account_enabled: false } }, admin, now: atEnd });
  assert.equal(privilegedRevoked.allowed, false, `revoked ${role} must not bypass the hard deny`);
}
const revokedOnboardingAdmin = {
  from: () => {
    const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: async () => ({ data: [{ id: 'revoked-row', access_status: 'revoked' }], error: null }) };
    return chain;
  },
};
for (const appMetadata of [
  { district_id: 'district-1', payment_status: 'paid', access_status: 'active' },
  { district_id: 'district-1', role: 'admin', access_status: 'active' },
  { district_id: 'district-1', role: 'demo_reviewer', access_status: 'active' },
]) {
  const unionDenied = await loadCanaryAccountAccess({ user: { email: 'revoked-source@district.org', app_metadata: appMetadata }, admin: revokedOnboardingAdmin, now: beforeEnd });
  assert.equal(unionDenied.reason, 'account_revoked', 'onboarding revocation must override complete and privileged Auth lifecycle state');
}
const ambiguousAdmin = {
  from: () => {
    const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: async () => ({ data: [{ id: 'one' }, { id: 'two' }], error: null }) };
    return chain;
  },
};
await assert.rejects(() => loadCanaryAccountAccess({ user: { email: 'duplicate@district.org', app_metadata: { district_id: 'district-1', access_status: 'active' } }, admin: ambiguousAdmin, now: atEnd }), /association is ambiguous/);
const missingTableAdmin = {
  from: () => {
    const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: async () => ({ data: null, error: { code: 'PGRST205' } }) };
    return chain;
  },
};
const legacyWithoutOnboardingTable = await loadCanaryAccountAccess({ user: { email: 'legacy@district.org', app_metadata: { district_id: 'legacy' } }, admin: missingTableAdmin, now: atEnd });
assert.equal(legacyWithoutOnboardingTable.allowed, true, 'a pre-onboarding-table deployment must not lock out legacy provisioned users');

const dashboard = await readFile(new URL('../src/app/dashboard/page.js', import.meta.url), 'utf8');
const gateIndex = dashboard.indexOf('loadCanaryAccountAccess');
const connectionIndex = dashboard.indexOf("adminClient.from('social_provider_connections')");
const dataIndex = dashboard.indexOf("loadDashboardDataset('District list'");
assert.ok(gateIndex >= 0 && connectionIndex > gateIndex && dataIndex > gateIndex, 'account access gate must run before integration or dashboard district/data loading');
assert.match(dashboard, /<TrialEnded/);
const actions = await readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8');
assert.ok(actions.indexOf('requireCanaryAccountAccess') < actions.indexOf('return { actor, admin }'), 'all customer server actions must share the access boundary');
const integrationAuth = await readFile(new URL('../src/lib/integration-auth.js', import.meta.url), 'utf8');
assert.match(integrationAuth, /await requireCanaryAccountAccess\(\{ user, admin \}\)/);
const integrationPage = await readFile(new URL('../src/app/dashboard/integrations/page.js', import.meta.url), 'utf8');
assert.ok(integrationPage.indexOf('loadCanaryAccountAccess') < integrationPage.indexOf('getDistricts()'));
const melodiRoute = await readFile(new URL('../src/app/api/melodi/route.js', import.meta.url), 'utf8');
assert.ok(melodiRoute.indexOf('loadCanaryAccountAccess') < melodiRoute.indexOf("admin.from('districts')"));
const endedUi = await readFile(new URL('../src/app/dashboard/TrialEnded.js', import.meta.url), 'utf8');
assert.match(endedUi, /Continue Your Access/);
assert.match(endedUi, /href="\/payment"/);
assert.match(endedUi, /Talk With Us/);
assert.match(endedUi, /mailto:hello@canarydata\.media/);
assert.match(endedUi, /!accessRevoked/);
const affiliatePage = await readFile(new URL('../src/app/dashboard/affiliates/page.js', import.meta.url), 'utf8');
assert.ok(affiliatePage.indexOf('const access=await loadCanaryAccountAccess') < affiliatePage.indexOf('const districts=await getDistricts()'), 'revoked privileged users must be denied before affiliate data loading');
const paymentPage = await readFile(new URL('../src/app/payment/page.js', import.meta.url), 'utf8');
assert.ok(paymentPage.indexOf('isCanaryAccountHardDenied(user.app_metadata') < paymentPage.indexOf('const amountLabel = getCanaryCheckoutAmountLabel'), 'revoked users must be denied before payment UI pricing');
const billing = await readFile(new URL('../src/lib/billing.js', import.meta.url), 'utf8');
assert.match(billing, /freshUserError \|\| !user\?\.id/);
assert.match(billing, /accountAccess\.onboardingRequest \|\| null/);
assert.doesNotMatch(billing, /order\('created_at'[\s\S]*limit\(1\)/);
const billingPage = await readFile(new URL('../src/app/billing/[documentType]/page.js', import.meta.url), 'utf8');
assert.ok(billingPage.indexOf('isCanaryAccountHardDenied(context.user.app_metadata') < billingPage.indexOf('const doc = buildBillingDocumentContext(context)'), 'revoked users must be denied before billing document rendering');

console.log('Trial access and pre-data dashboard gate tests passed.');
