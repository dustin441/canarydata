import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/20260902223000_canary_collection_entitlement_pilot.sql', import.meta.url), 'utf8');
const n8nFilter = await readFile(new URL('./n8n/canary-enforce-collection-entitlement.js', import.meta.url), 'utf8');

assert.match(sql, /revoke all on table public\.district_entitlements[\s\S]*public, anon, authenticated, service_role/);
assert.match(sql, /revoke all on table public\.district_entitlement_events[\s\S]*public, anon, authenticated, service_role/);
assert.match(sql, /revoke all on table public\.canary_effective_district_entitlements[\s\S]*public, anon, authenticated, service_role/);
assert.match(sql, /grant select on table public\.district_entitlements to service_role/);
assert.match(sql, /grant select on table public\.district_entitlement_events to service_role/);
assert.match(sql, /grant select on table public\.canary_effective_district_entitlements to service_role/);
assert.match(sql, /create or replace function public\.canary_collection_query_gate/);
assert.match(sql, /v_district_id <> 'canary-lesley-test-district'/);
assert.match(sql, /'enforced', false[\s\S]*'allowed', true[\s\S]*'not_in_internal_pilot'/);
assert.match(sql, /'enforced', true[\s\S]*'allowed', v_allowed/);
for (const state of ['missing', 'revoked', 'manual_hold', 'inactive_frozen', 'expired', 'active']) {
  assert.match(sql, new RegExp(`pilot_entitlement_${state}`));
}
assert.doesNotMatch(sql, /process\.env|current_setting|p_pilot|pilot_district_ids/i);
assert.match(sql, /revoke all on function public\.canary_collection_query_gate\(jsonb, timestamptz\)[\s\S]*public, anon, authenticated, service_role/);
assert.match(sql, /grant execute on function public\.canary_collection_query_gate\(jsonb, timestamptz\)[\s\S]*to service_role/);
assert.match(n8nFilter, /decision\.enforced === false && decision\.allowed !== true/);
assert.match(n8nFilter, /decision\.allowed === true/);
assert.match(n8nFilter, /decision is missing or malformed/);

console.log('Internal-only Canary collection entitlement pilot contract tests passed.');
