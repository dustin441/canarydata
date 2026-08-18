import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/20260818162000_canary_payment_fulfillment.sql', import.meta.url), 'utf8');
assert.match(sql, /checkout_session_id text primary key/);
assert.match(sql, /stripe_event_id text unique/);
assert.match(sql, /from auth\.users[\s\S]*for update/);
assert.match(sql, /p_expected_app_metadata is null[\s\S]*v_app is distinct from p_expected_app_metadata/);
assert.match(sql, /from public\.onboarding_requests[\s\S]*for update/);
assert.match(sql, /greatest\(coalesce\(v_existing_paid_through, p_charge_paid_at\), p_charge_paid_at\) \+ interval '1 year'/);
assert.match(sql, /insert into public\.canary_payment_fulfillments/);
assert.match(sql, /update public\.onboarding_requests[\s\S]*update auth\.users/);
assert.match(sql, /revoke all on function public\.fulfill_canary_stripe_payment/);
assert.match(sql, /grant execute on function public\.fulfill_canary_stripe_payment[\s\S]*to service_role/);
assert.match(sql, /patch_canary_protected_app_metadata/);
assert.match(sql, /p_expected_app_metadata is not null and v_app is distinct from p_expected_app_metadata/);
assert.match(sql, /coalesce\(v_app ->> 'stripe_customer_id', ''\) is distinct from coalesce\(p_expected_customer_id, ''\)/);
assert.doesNotMatch(sql, /grant execute[\s\S]*to authenticated/);
console.log('Transactional payment fulfillment migration contract tests passed.');
