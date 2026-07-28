import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { buildOnboardingTask } from '../src/lib/onboardingClickup.mjs';
import { buildFeedbackTask } from '../src/lib/clickup.js';

const API_BASE = 'https://api.clickup.com/api/v2';
const CLICKUP_API_TOKEN = process.env.CANARY_CLICKUP_API_TOKEN || process.env.CLICKUP_API_TOKEN;
const CLICKUP_LIST_ID = process.env.CANARY_CLICKUP_LIST_ID || process.env.CLICKUP_LIST_ID;
const apply = process.argv.includes('--apply');
const feedbackIdArg = process.argv.find((arg) => arg.startsWith('--feedback-id='));
const onboardingIdArg = process.argv.find((arg) => arg.startsWith('--onboarding-id='));
const reconcileIdArg = process.argv.find((arg) => arg.startsWith('--reconcile-feedback-id='));
const reconciliationRecordId = reconcileIdArg ? reconcileIdArg.slice('--reconcile-feedback-id='.length).trim() : '';
const targetFeedbackId = feedbackIdArg ? feedbackIdArg.slice('--feedback-id='.length).trim() : '';
const targetOnboardingId = onboardingIdArg ? onboardingIdArg.slice('--onboarding-id='.length).trim() : '';
const reconcileDispatch = Boolean(reconcileIdArg);
const releaseDispatch = process.argv.includes('--release-dispatch');
if (releaseDispatch && !reconcileDispatch) {
  console.error('--release-dispatch requires --reconcile-feedback-id=<id>.');
  process.exit(1);
}

const requiredEnv = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const missing = requiredEnv.filter((key) => !process.env[key]);
if (!CLICKUP_API_TOKEN) missing.push('CANARY_CLICKUP_API_TOKEN or CLICKUP_API_TOKEN');
if (!CLICKUP_LIST_ID) missing.push('CANARY_CLICKUP_LIST_ID or CLICKUP_LIST_ID');
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isQueryReview(feedback) {
  return String(feedback.message || '').startsWith('[Query activation review]');
}

function isLeadRequest(feedback) {
  return String(feedback.message || '').startsWith('Light demo/sign-up lead submitted.');
}

function isOnboardingRequest(feedback) {
  return feedback._source === 'onboarding_requests' || String(feedback.message || '').startsWith('30-day trial onboarding request confirmed by prospect.');
}

const rowTable = (row) => row._source || 'feedback';
const rowHasTrackingColumns = (row) => row._source === 'onboarding_requests' || row._feedbackHasTrackingColumns;

function taskNameForFeedback(feedback) {
  const district = compact(feedback.district_name || feedback.district_id) || 'General';
  const summary = compact(feedback.message).slice(0, 90);
  if (isQueryReview(feedback)) {
    const action = compact(String(feedback.message || '').match(/Requested action:\s*([^\n]+)/i)?.[1] || 'change');
    return `[Query activation review] ${district}: ${action}`;
  }
  if (isLeadRequest(feedback)) return `[Demo lead] ${district}`;
  if (isOnboardingRequest(feedback)) return `[Trial onboarding] ${district}`;
  return `[Site feedback] ${district}${summary ? `: ${summary}` : ''}`;
}

function taskDescriptionForFeedback(feedback) {
  const lines = [
    isLeadRequest(feedback) ? '## Demo/sign-up lead' : (isOnboardingRequest(feedback) ? '## Trial onboarding fallback' : '## Site feedback'),
    '',
    feedback.message || '',
    '',
    '---',
    `${feedback._source === 'onboarding_requests' ? 'Onboarding request ID' : 'Feedback ID'}: ${feedback.id}`,
    `Submitted: ${feedback.created_at || 'Unknown'}`,
    `District: ${feedback.district_name || 'Unknown'}`,
    `District ID: ${feedback.district_id || 'Unknown'}`,
  ];

  if (feedback.photo_url) lines.push(`Screenshot: ${feedback.photo_url}`);
  return lines.join('\n');
}

function feedbackTags() {
  const configured = process.env.CLICKUP_FEEDBACK_TAGS;
  if (!configured) return ['site-feedback', 'canary-data'];
  return configured
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function tagsForFeedback(feedback) {
  if (isQueryReview(feedback)) return ['query-review', 'customer-request', 'canary-data'];
  if (isLeadRequest(feedback)) return ['lead-request', 'canary-data'];
  if (isOnboardingRequest(feedback)) return ['trial-onboarding', 'canary-data'];
  return feedbackTags();
}

async function createClickUpTask(feedback) {
  const task = isOnboardingRequest(feedback)
    ? buildOnboardingTask(feedback)
    : (isQueryReview(feedback) ? {
        name: taskNameForFeedback(feedback),
        markdown_content: taskDescriptionForFeedback(feedback),
        tags: tagsForFeedback(feedback),
      } : buildFeedbackTask(feedback));
  const response = await fetch(`${API_BASE}/list/${CLICKUP_LIST_ID}/task`, {
    method: 'POST',
    headers: {
      Authorization: CLICKUP_API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...task,
      notify_all: false,
    }),
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }

  if (!response.ok) {
    const error = new Error(payload?.err || payload?.message || `ClickUp returned ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return payload;
}

function sourceRecordId(task) {
  const text = [task?.description, task?.text_content, task?.markdown_description].filter(Boolean).join('\n');
  return text.match(/(?:Feedback ID|Request record ID|Onboarding request ID):\s*([^\s]+)/i)?.[1] || null;
}

async function existingClickUpTasksByRecordId() {
  const byRecordId = new Map();
  for (let page = 0; page < 100; page += 1) {
    const response = await fetch(`${API_BASE}/list/${CLICKUP_LIST_ID}/task?page=${page}&include_closed=true&subtasks=true`, {
      headers: { Authorization: CLICKUP_API_TOKEN },
    });
    if (!response.ok) throw new Error(`Could not inspect existing ClickUp tasks (${response.status}).`);
    const payload = await response.json();
    const tasks = payload.tasks || [];
    for (const task of tasks) {
      const recordId = sourceRecordId(task);
      if (recordId && !byRecordId.has(recordId)) byRecordId.set(recordId, task);
    }
    if (tasks.length === 0 || payload.last_page === true) break;
  }
  return byRecordId;
}

let feedbackQuery = supabase
  .from('feedback')
  .select('*')
  .order('created_at', { ascending: true });
const feedbackLookupId = reconciliationRecordId || targetFeedbackId;
if (feedbackLookupId) feedbackQuery = feedbackQuery.eq('id', feedbackLookupId);
else if (targetOnboardingId) feedbackQuery = feedbackQuery.limit(0);
const { data: rawFeedbackRows, error: feedbackError } = await feedbackQuery;

let onboardingQuery = supabase
  .from('onboarding_requests')
  .select('*')
  .order('created_at', { ascending: true });
const onboardingLookupId = reconciliationRecordId || targetOnboardingId;
if (onboardingLookupId) onboardingQuery = onboardingQuery.eq('id', onboardingLookupId);
else if (targetFeedbackId) onboardingQuery = onboardingQuery.limit(0);
const { data: onboardingData, error: onboardingError } = await onboardingQuery;
const onboardingTableMissing = onboardingError && (onboardingError.code === 'PGRST205' || /schema cache/i.test(onboardingError.message || ''));
const rawOnboardingRows = onboardingTableMissing ? [] : (onboardingData || []);

if (feedbackError || (onboardingError && !onboardingTableMissing)) {
  console.error(feedbackError?.message || onboardingError?.message);
  process.exit(1);
}
if (onboardingTableMissing) console.warn('onboarding_requests is unavailable; structured onboarding retry is inactive until that table is installed.');

const feedbackHasTrackingColumns =
  rawFeedbackRows.length === 0 || Object.prototype.hasOwnProperty.call(rawFeedbackRows[0], 'clickup_task_id');
const feedbackRows = rawFeedbackRows.map((row) => ({ ...row, _source: 'feedback', _feedbackHasTrackingColumns: feedbackHasTrackingColumns }));
const onboardingRows = rawOnboardingRows.map((row) => ({
  ...row,
  _source: 'onboarding_requests',
  district_name: row.organization_name,
  message: [
    '30-day trial onboarding request confirmed by prospect.',
    `Contact: ${row.contact_name || 'Unknown'} <${row.contact_email || 'Unknown'}>`,
    `Organization: ${row.organization_name || 'Unknown'}`,
    `Website: ${row.website || 'Unknown'}`,
  ].join('\n'),
}));
const allRows = [...feedbackRows, ...onboardingRows];

if (!feedbackHasTrackingColumns) {
  console.warn('ClickUp tracking columns are missing from feedback. Falling back to status-only sync markers for feedback rows.');
}

const statusShowsSynced = (row) => Boolean(row.clickup_task_id) || row.status === 'clickup_synced' || /^(?:lead|onboarding)_clickup_synced$/.test(String(row.status || '')) || String(row.status || '').startsWith('query_review_synced:');
const statusShowsDispatching = (row) => String(row.status || '').includes('clickup_dispatching:') || String(row.status || '').startsWith('query_review_dispatching');
const pendingRows = allRows.filter((row) => {
  if (statusShowsSynced(row) || statusShowsDispatching(row)) return false;
  if (isQueryReview(row)) return row.status === 'query_review_pending';
  if (row._source === 'onboarding_requests') return ['submitted', 'clickup_failed'].includes(String(row.status || ''));
  return !feedbackHasTrackingColumns || !row.clickup_task_id;
});

console.log(`${feedbackRows.length} feedback rows and ${onboardingRows.length} onboarding rows found; ${pendingRows.length} pending ClickUp sync.`);
const existingTasks = apply ? await existingClickUpTasksByRecordId() : new Map();

if (reconcileDispatch) {
  if (!apply) {
    console.error('Dispatch reconciliation requires --apply.');
    process.exit(1);
  }
  const matches = allRows.filter((candidate) => String(candidate.id) === reconciliationRecordId);
  const row = matches[0];
  if (matches.length !== 1) {
    console.error(`Exactly one feedback or onboarding row ${reconciliationRecordId} was required; found ${matches.length}.`);
    process.exit(1);
  }
  if (!statusShowsDispatching(row)) {
    console.error(`Record ${reconciliationRecordId} is not in a dispatching state.`);
    process.exit(1);
  }
  const existingTask = existingTasks.get(String(row.id));
  if (existingTask) {
    const updatePayload = rowHasTrackingColumns(row)
      ? {
          status: row._source === 'onboarding_requests' ? 'submitted' : 'clickup_synced',
          clickup_task_id: existingTask.id,
          clickup_task_url: existingTask.url || null,
          clickup_synced_at: new Date().toISOString(),
          clickup_sync_error: null,
        }
      : {
          status: isQueryReview(row) ? `query_review_synced:${existingTask.id}` : 'clickup_synced',
        };
    const { data: linked, error: linkError } = await supabase
      .from(rowTable(row))
      .update(updatePayload)
      .eq('id', row.id)
      .eq('status', row.status)
      .select('id')
      .maybeSingle();
    if (linkError || !linked) {
      console.error(linkError?.message || 'Dispatch ownership changed before reconciliation.');
      process.exit(1);
    }
    console.log(`[reconciled] ${row.id} -> ${existingTask.id}`);
    process.exit(0);
  }
  if (!releaseDispatch) {
    console.error(`[reserved] No existing ClickUp task was found for ${row.id}; dispatch ownership was retained. Re-run with --release-dispatch only after confirming retry is intended.`);
    process.exit(2);
  }
  const releasedStatus = isQueryReview(row) ? 'query_review_pending' : 'clickup_failed';
  const { data: released, error: releaseError } = await supabase
    .from(rowTable(row))
    .update({ status: releasedStatus })
    .eq('id', row.id)
    .eq('status', row.status)
    .select('id')
    .maybeSingle();
  if (releaseError || !released) {
    console.error(releaseError?.message || 'Dispatch ownership changed before release.');
    process.exit(1);
  }
  console.log(`[released] ${row.id} -> ${releasedStatus}; run the normal targeted worker to retry.`);
  process.exit(0);
}

let syncFailures = 0;
for (const row of pendingRows) {
  const taskName = taskNameForFeedback(row);

  if (!apply) {
    console.log(`[dry-run] ${row.id} -> ${taskName}`);
    continue;
  }

  const claimPrefix = row._source === 'onboarding_requests' ? 'onboarding_clickup' : (isQueryReview(row) ? 'query_review' : 'clickup');
  const claimStatus = `${claimPrefix}_dispatching:${Date.now()}:${randomUUID()}`;
  let claim = supabase
    .from(rowTable(row))
    .update({ status: claimStatus })
    .eq('id', row.id);
  claim = row.status === null ? claim.is('status', null) : claim.eq('status', row.status);
  const { data: claimed, error: claimError } = await claim.select('id').maybeSingle();
  if (claimError) {
    syncFailures += 1;
    console.error(`[claim-failed] ${row.id}: ${claimError.message}`);
    continue;
  }
  if (!claimed) {
    console.log(`[skipped-claimed] ${row.id}`);
    continue;
  }

  try {
    const task = existingTasks.get(String(row.id)) || await createClickUpTask(row);
    existingTasks.set(String(row.id), task);
    const updatePayload = rowHasTrackingColumns(row)
      ? {
          status: row._source === 'onboarding_requests' ? 'submitted' : 'clickup_synced',
          clickup_task_id: task.id,
          clickup_task_url: task.url || null,
          clickup_synced_at: new Date().toISOString(),
          clickup_sync_error: null,
        }
      : {
          status: isQueryReview(row) ? `query_review_synced:${task.id}` : 'clickup_synced',
        };

    const { data: linked, error: updateError } = await supabase
      .from(rowTable(row))
      .update(updatePayload)
      .eq('id', row.id)
      .eq('status', claimStatus)
      .select('id')
      .maybeSingle();

    if (updateError) throw updateError;
    if (!linked) throw new Error('Lost the ClickUp dispatch claim before linking the task.');
    console.log(`[synced] ${row.id} -> ${task.id}`);
  } catch (syncError) {
    syncFailures += 1;
    const definiteRejection = Number.isInteger(syncError.status)
      && syncError.status >= 400
      && syncError.status < 500
      && ![408, 425, 429].includes(syncError.status);
    if (definiteRejection) {
      const updatePayload = rowHasTrackingColumns(row)
        ? {
            status: 'clickup_failed',
            clickup_sync_error: syncError.message || 'Unknown ClickUp error',
          }
        : {
            status: isQueryReview(row) ? 'query_review_pending' : 'clickup_failed',
          };
      await supabase
        .from(rowTable(row))
        .update(updatePayload)
        .eq('id', row.id)
        .eq('status', claimStatus);
    }
    console.error(`[failed] ${row.id}: ${syncError.message}`);
  }
}

if (syncFailures > 0) process.exitCode = 1;
