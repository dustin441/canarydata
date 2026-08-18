import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const preload = resolve(root, 'scripts/fixtures/pricing-ops-fetch-mock.mjs');
const baseEnv = {
  ...process.env,
  CANARY_PROD_SUPABASE_URL: 'https://unit-test.supabase.co',
  CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  STRIPE_SECRET_KEY: 'stripe-test',
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

console.log('Pricing operational script conflict, CAS, and pagination tests passed.');
