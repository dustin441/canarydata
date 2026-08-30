import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260818150000_onboarding_intake_reliability.sql', import.meta.url), 'utf8');
const actions = await readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8');
const retry = await readFile(new URL('./sync-feedback-to-clickup.mjs', import.meta.url), 'utf8');

assert.match(migration, /create table if not exists public\.onboarding_requests/i);
assert.match(migration, /alter table public\.onboarding_requests enable row level security/i);
assert.match(migration, /add column if not exists clickup_task_id text/i);
assert.match(migration, /add column if not exists clickup_task_url text/i);
assert.match(migration, /add column if not exists clickup_synced_at timestamptz/i);
assert.match(migration, /add column if not exists clickup_sync_error text/i);
assert.match(migration, /add column if not exists trial_starts_at timestamptz/i);
assert.match(migration, /add column if not exists paid_through timestamptz/i);
assert.match(migration, /add column if not exists billing_address_line1 text/i);
assert.doesNotMatch(migration, /create table[\s\S]*trial_started_at timestamptz/i);
assert.match(migration, /alter table public\.feedback add column if not exists clickup_task_id text/i);
assert.match(migration, /alter table public\.feedback add column if not exists clickup_task_url text/i);
assert.match(actions, /from\('onboarding_requests'\)/);
assert.match(retry, /structured onboarding retry is inactive until that table is installed/);

console.log('Onboarding persistence migration tests passed.');
