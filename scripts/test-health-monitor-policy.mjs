import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./check-canary-health.mjs', import.meta.url), 'utf8');
const wrapper = await readFile(new URL('./run-canary-health-alert.py', import.meta.url), 'utf8');
assert.match(source, /new Set\(generatedQueries\.map/, 'only canonical generated queries should define scheduled districts');
assert.doesNotMatch(source, /district_collection_stale_36h/, 'zero-result districts must not be reported as scheduler failures');
assert.match(source, /Zero stored results alone does not prove a scheduler failure/);
assert.match(source, /workflow_no_success_36h/, 'workflow execution freshness must remain a critical scheduler check');
assert.match(source, /query_review_pending_over_24h/, 'stale customer query reviews must be monitored');
assert.match(source, /query_review_dispatch_uncertain_over_1h/, 'uncertain query-review dispatches must be surfaced without automatic retry');
assert.match(source, /feedback_dispatch_uncertain_over_1h/, 'uncertain ordinary feedback dispatches must also be surfaced');
assert.match(source, /feedback_clickup_pending_over_24h/, 'failed or queued lead, onboarding, and ordinary feedback tasks must be monitored');
assert.match(source, /status: 'is\.null'/, 'ordinary feedback queued without ClickUp configuration must be monitored');
assert.match(source, /onboarding_clickup_pending_over_24h/, 'structured onboarding ClickUp failures must be monitored');
assert.match(source, /uncertainOnboardingDispatches/, 'uncertain structured onboarding dispatches must be monitored');
assert.match(source, /feedbackDispatchAgeHours/, 'dispatch age must be derived from reservation metadata');
assert.match(source, /feedbackDispatchAgeHours\(request, now\)/, 'one-hour uncertainty must use dispatch start, not feedback creation time');
assert.match(source, /unresolved_query_reviews: pendingQueryReviews\.length/);
assert.match(source, /request_id: request_id \|\| null/, 'review request IDs must affect change fingerprints');
assert.match(source, /\.sort\(\(a, b\) => JSON\.stringify\(a\)\.localeCompare\(JSON\.stringify\(b\)\)\)/, 'alert fingerprints must be order-stable');
assert.match(wrapper, /sync-feedback-to-clickup\.mjs','--apply'/, 'the daily health job must run the ClickUp retry worker before monitoring');
assert.match(wrapper, /CLICKUP_LIST_ID/, 'the retry worker must target the dedicated Canary ClickUp list');
assert.match(wrapper, /CANARY_CLICKUP_API_TOKEN/, 'the scheduled worker must override stale generic ClickUp credentials');
assert.match(wrapper, /env\['NEXT_PUBLIC_SUPABASE_URL'\]=env\.get\('CANARY_PROD_SUPABASE_URL'/, 'the scheduled worker must force the canonical Canary Supabase URL');
assert.match(wrapper, /env\['SUPABASE_SERVICE_ROLE_KEY'\]=env\.get\('CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY'/, 'the scheduled worker must force the canonical Canary service key');
assert.match(wrapper, /raise SystemExit\(sync_result\.returncode\)/, 'retry failures must fail the daily job instead of disappearing');

console.log('Health monitor policy tests passed.');
