import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { feedbackDispatchAgeHours, feedbackDispatchStartedAt } from '../src/lib/feedbackDispatch.mjs';
import { buildFeedbackTask } from '../src/lib/clickup.js';

const now = new Date('2026-07-28T12:00:00.000Z');
const fiveMinutesAgo = now.getTime() - 5 * 60_000;
const twoHoursAgo = now.getTime() - 2 * 3_600_000;
const oldCreatedAt = '2026-07-26T12:00:00.000Z';

const freshWorkerClaim = {
  status: `query_review_dispatching:${fiveMinutesAgo}:worker-id`,
  created_at: oldCreatedAt,
};
assert.equal(feedbackDispatchStartedAt(freshWorkerClaim).getTime(), fiveMinutesAgo);
assert.ok(feedbackDispatchAgeHours(freshWorkerClaim, now) < 0.09, 'an old record with a fresh claim must not appear stale');

const staleOrdinaryClaim = {
  status: `clickup_dispatching:${twoHoursAgo}:worker-id`,
  created_at: now.toISOString(),
};
assert.ok(feedbackDispatchAgeHours(staleOrdinaryClaim, now) >= 2, 'dispatch timing must work for ordinary feedback');

const legacyClaim = {
  status: 'query_review_dispatching',
  created_at: oldCreatedAt,
};
assert.equal(feedbackDispatchAgeHours(legacyClaim, now), 48, 'legacy reservations must fall back to record creation time');
assert.equal(feedbackDispatchAgeHours({ status: 'clickup_dispatching:invalid', created_at: 'invalid' }, now), Number.POSITIVE_INFINITY);

const leadTask = buildFeedbackTask({
  id: 'lead-id',
  created_at: now.toISOString(),
  district_name: 'Parity Public Schools',
  message: 'Light demo/sign-up lead submitted.\n\nContact: Pat Parity <pat@example.test>',
});
assert.equal(leadTask.name, '[Demo lead] Parity Public Schools');
assert.match(leadTask.markdown_content, /## Demo\/sign-up lead/);
assert.match(leadTask.markdown_content, /Feedback ID: lead-id/);
assert.deepEqual(leadTask.tags, ['lead-request', 'canary-data']);

const actionsSource = await readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('./sync-feedback-to-clickup.mjs', import.meta.url), 'utf8');
assert.match(actionsSource, /transitionFeedbackClickUpDispatch/);
assert.match(actionsSource, /\.eq\('status', expectedStatus\)[\s\S]{0,120}\.select\('id'\)[\s\S]{0,80}\.maybeSingle\(\)/, 'direct dispatch outcomes must use an exact compare-and-set');
assert.match(actionsSource, /feedbackTrackingColumnsUnavailable/, 'the live legacy feedback schema must retain status-only compatibility');
assert.match(workerSource, /buildFeedbackTask\(feedback\)/, 'lead retry payloads must share the direct producer builder');
assert.match(workerSource, /CANARY_CLICKUP_LIST_ID \|\| process\.env\.CLICKUP_LIST_ID/, 'the dedicated Canary list must override a stale generic ClickUp list');
assert.match(workerSource, /CANARY_CLICKUP_API_TOKEN \|\| process\.env\.CLICKUP_API_TOKEN/, 'the dedicated Canary token must override stale generic ClickUp credentials');
assert.match(workerSource, /if \(syncFailures > 0\) process\.exitCode = 1/, 'worker failures must surface to the scheduler');

console.log('Feedback dispatch timing tests passed.');
