import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildClientAccessDirectory } from '../src/lib/clientAccess.mjs';

const rows = buildClientAccessDirectory([
  { id: 'admin', email: 'admin@canary.example', app_metadata: { role: 'admin' }, user_metadata: {} },
  { id: 'demo', email: 'reviewer@canary.example', app_metadata: { role: 'demo_reviewer' }, user_metadata: {} },
  { id: 'fairfax', email: 'customer@district.example', created_at: '2026-09-01T00:00:00Z', last_sign_in_at: '2026-09-02T00:00:00Z', app_metadata: { district_id: 'fairfax-county-public-schools', trial_status: 'active', trial_ends_at: '2026-10-03T00:00:00Z', access_status: 'active' }, user_metadata: { first_name: 'Delaina', last_name: 'McCormack' } },
], new Date('2026-09-03T00:00:00Z'));
assert.deepEqual(rows, [{
  id: 'fairfax',
  district_id: 'fairfax-county-public-schools',
  first_name: 'Delaina',
  last_name: 'McCormack',
  email: 'customer@district.example',
  created_at: '2026-09-01T00:00:00Z',
  last_sign_in_at: '2026-09-02T00:00:00Z',
  access_state: 'active',
  access_reason: 'trial_or_legacy_access',
  trial_ends_at: '2026-10-03T00:00:00Z',
}]);

const dataSource = await readFile(new URL('../src/lib/data.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
assert.match(dataSource, /auth\.admin\.listUsers/);
assert.doesNotMatch(dataSource.slice(dataSource.indexOf('export async function getClients'), dataSource.indexOf('export async function getCollectionHealth')), /client_credentials|temp_password/);
assert.doesNotMatch(dashboard, /Temp Password|c\.temp_password|toggleReveal/);
assert.match(dashboard, /Customer Access/);
assert.match(dashboard, /Forgot Password/);
assert.match(dashboard, /https:\/\/www\.canarydata\.media\/login/);
console.log('Safe customer access directory tests passed.');
