import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const preload = resolve(root, 'scripts/fixtures/pricing-ops-fetch-mock.mjs');
const baseEnv = {
  ...process.env,
  CANARY_PROD_SUPABASE_URL: 'https://unit-test.supabase.co',
  CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  STRIPE_SECRET_KEY: 'stripe-test',
  NODE_ENV: 'test',
};
function run(script, args, scenario) {
  return spawnSync(process.execPath, ['--import', preload, resolve(root, script), ...args], {
    cwd: root,
    env: { ...baseEnv, CANARY_OPS_TEST_SCENARIO: scenario },
    encoding: 'utf8',
  });
}

const duplicate = run('scripts/backfill-stripe-customer-ownership.mjs', [], 'duplicate-customer');
assert.notEqual(duplicate.status, 0);
assert.match(`${duplicate.stderr}${duplicate.stdout}`, /Duplicate protected Stripe Customer links detected/);

const downgrade = run('scripts/set-canary-pricing-entitlement.mjs', [
  '--email', 'paid@district.org', '--locked-at', '2026-08-31T12:00:00-07:00',
  '--commitment-reference', 'commitment-1', '--po-reference', 'po-1',
], 'paid-downgrade');
assert.notEqual(downgrade.status, 0);
assert.match(`${downgrade.stderr}${downgrade.stdout}`, /Refusing to downgrade or overwrite/);

const capped = run('scripts/set-canary-pricing-entitlement.mjs', [
  '--email', 'missing@district.org', '--locked-at', '2026-08-31T12:00:00-07:00',
  '--commitment-reference', 'commitment-1', '--po-reference', 'po-1',
], 'pagination-cap');
assert.notEqual(capped.status, 0);
assert.match(`${capped.stderr}${capped.stdout}`, /5,000-user safety cap before exhaustion/);

const casConflict = run('scripts/set-canary-pricing-entitlement.mjs', [
  '--email', 'lock@district.org', '--locked-at', '2026-08-31T12:00:00-07:00',
  '--commitment-reference', 'commitment-1', '--po-reference', 'po-1', '--apply',
], 'cas-conflict');
assert.notEqual(casConflict.status, 0);
assert.match(`${casConflict.stderr}${casConflict.stdout}`, /atomically save Canary pricing entitlement/);

const rosterFile = resolve(root, '.nspra-test-roster.json');
const rosterContacts = [
  { email: 'nspra@district.org', eligibility_reference: 'sheet-row-2' },
  ...Array.from({ length: 54 }, (_, index) => ({ email: `approved-${index + 1}@district.org`, eligibility_reference: `sheet-row-${index + 3}` })),
];
writeFileSync(rosterFile, JSON.stringify({ program: 'nspra_2026', contacts: rosterContacts }));
const nspraDryRun = run('scripts/set-canary-nspra-eligibility.mjs', [
  '--email', 'nspra@district.org', '--roster-file', rosterFile,
], 'nspra-dry-run');
assert.equal(nspraDryRun.status, 0);
const nspraOutput = JSON.parse(nspraDryRun.stdout);
assert.equal(nspraOutput.dryRun, true);
assert.equal(nspraOutput.districtId, 'district-nspra');
assert.equal(nspraOutput.offerCode, 'nspra_2026');
assert.equal(nspraOutput.expiresAt, '2026-10-01T00:00:00-07:00');
const nspraIdempotent = run('scripts/set-canary-nspra-eligibility.mjs', [
  '--email', 'nspra@district.org', '--roster-file', rosterFile, '--apply',
], 'nspra-idempotent');
assert.equal(nspraIdempotent.status, 0);
const idempotentOutput = JSON.parse(nspraIdempotent.stdout);
assert.equal(idempotentOutput.idempotent, true);
assert.equal(idempotentOutput.dryRun, false);
const nspraPoDryRun = run('scripts/qualify-canary-nspra-po.mjs', [
  '--email', 'nspra@district.org', '--roster-file', rosterFile, '--po-number', 'PO-2026-1',
], 'nspra-po-dry-run');
assert.equal(nspraPoDryRun.status, 0);
const poOutput = JSON.parse(nspraPoDryRun.stdout);
assert.equal(poOutput.dryRun, true);
assert.equal(poOutput.proposedAnnualPriceCents, 149900);
assert.equal(poOutput.proposedRenewalPriceCents, 149900);
const nspraPoIdempotent = run('scripts/qualify-canary-nspra-po.mjs', [
  '--email', 'nspra@district.org', '--roster-file', rosterFile, '--po-number', 'PO-2026-1', '--apply',
], 'nspra-po-idempotent');
assert.equal(nspraPoIdempotent.status, 0);
const poIdempotentOutput = JSON.parse(nspraPoIdempotent.stdout);
assert.equal(poIdempotentOutput.idempotent, true);
assert.equal(poIdempotentOutput.readbackVerified, true);
const nspraPoApply = run('scripts/qualify-canary-nspra-po.mjs', [
  '--email', 'nspra@district.org', '--roster-file', rosterFile, '--po-number', 'PO-2026-1', '--apply',
], 'nspra-po-apply');
assert.equal(nspraPoApply.status, 0);
assert.equal(JSON.parse(nspraPoApply.stdout).readbackVerified, true);
const lateIdempotent = run('scripts/qualify-canary-nspra-po.mjs', [
  '--email', 'nspra@district.org', '--roster-file', rosterFile, '--po-number', 'PO-2026-1', '--apply',
], 'nspra-po-late-idempotent');
assert.equal(lateIdempotent.status, 0, 'an exact idempotent readback must remain available after the deadline');
assert.equal(JSON.parse(lateIdempotent.stdout).idempotent, true);
const lateNew = run('scripts/qualify-canary-nspra-po.mjs', [
  '--email', 'nspra@district.org', '--roster-file', rosterFile, '--po-number', 'PO-2026-1',
], 'nspra-po-late-new');
assert.notEqual(lateNew.status, 0);
assert.match(`${lateNew.stderr}${lateNew.stdout}`, /must be received before/);
const complimentaryPo = run('scripts/qualify-canary-nspra-po.mjs', [
  '--email', 'nspra@district.org', '--roster-file', rosterFile, '--po-number', 'PO-2026-1',
], 'nspra-po-complimentary');
assert.notEqual(complimentaryPo.status, 0);
assert.match(`${complimentaryPo.stderr}${complimentaryPo.stdout}`, /Refusing to downgrade or overwrite/);

const missingRosterEntry = run('scripts/set-canary-nspra-eligibility.mjs', [
  '--email', 'not-approved@district.org', '--roster-file', rosterFile,
], 'nspra-dry-run');
assert.notEqual(missingRosterEntry.status, 0);
assert.match(`${missingRosterEntry.stderr}${missingRosterEntry.stdout}`, /exactly one finite-roster entry/);
const shortRosterFile = resolve(root, '.nspra-short-test-roster.json');
writeFileSync(shortRosterFile, JSON.stringify({ program: 'nspra_2026', contacts: [{ email: 'nspra@district.org', eligibility_reference: 'sheet-row-2' }] }));
const shortRoster = run('scripts/qualify-canary-nspra-po.mjs', [
  '--email', 'nspra@district.org', '--roster-file', shortRosterFile, '--po-number', 'PO-2026-1',
], 'nspra-po-dry-run');
assert.notEqual(shortRoster.status, 0);
assert.match(`${shortRoster.stderr}${shortRoster.stdout}`, /exactly 55 unique valid contacts/);
const nspraScript = await import('node:fs/promises').then(({ readFile }) => readFile(resolve(root, 'scripts/set-canary-nspra-eligibility.mjs'), 'utf8'));
assert.doesNotMatch(nspraScript, /granted-at|locked-at/, 'NSPRA operator must not permit caller-supplied backdating');
rmSync(rosterFile);
rmSync(shortRosterFile);

console.log('Pricing operational script conflict, CAS, pagination, and NSPRA eligibility tests passed.');
