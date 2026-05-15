import { createClient } from '@supabase/supabase-js';

const API_BASE = 'https://api.clickup.com/api/v2';
const apply = process.argv.includes('--apply');

const requiredEnv = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CLICKUP_API_TOKEN',
  'CLICKUP_LIST_ID',
];

const missing = requiredEnv.filter((key) => !process.env[key]);
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

function taskNameForFeedback(feedback) {
  const district = compact(feedback.district_name || feedback.district_id) || 'General';
  const summary = compact(feedback.message).slice(0, 90);
  return `[Site feedback] ${district}${summary ? `: ${summary}` : ''}`;
}

function taskDescriptionForFeedback(feedback) {
  const lines = [
    '## Site feedback',
    '',
    feedback.message || '',
    '',
    '---',
    `Feedback ID: ${feedback.id}`,
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

async function createClickUpTask(feedback) {
  const response = await fetch(`${API_BASE}/list/${process.env.CLICKUP_LIST_ID}/task`, {
    method: 'POST',
    headers: {
      Authorization: process.env.CLICKUP_API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: taskNameForFeedback(feedback),
      markdown_content: taskDescriptionForFeedback(feedback),
      tags: feedbackTags(),
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
    throw new Error(payload?.err || payload?.message || `ClickUp returned ${response.status}`);
  }

  return payload;
}

const { data: feedbackRows, error } = await supabase
  .from('feedback')
  .select('*')
  .order('created_at', { ascending: true });

if (error) {
  console.error(error.message);
  process.exit(1);
}

const hasTrackingColumns =
  feedbackRows.length === 0 || Object.prototype.hasOwnProperty.call(feedbackRows[0], 'clickup_task_id');

if (!hasTrackingColumns) {
  console.warn('ClickUp tracking columns are missing. Falling back to status-only sync markers.');
}

const pendingRows = hasTrackingColumns
  ? feedbackRows.filter((row) => !row.clickup_task_id)
  : feedbackRows.filter((row) => row.status !== 'clickup_synced');

console.log(`${feedbackRows.length} feedback rows found; ${pendingRows.length} pending ClickUp sync.`);

for (const row of pendingRows) {
  const taskName = taskNameForFeedback(row);

  if (!apply) {
    console.log(`[dry-run] ${row.id} -> ${taskName}`);
    continue;
  }

  try {
    const task = await createClickUpTask(row);
    const updatePayload = hasTrackingColumns
      ? {
          status: 'clickup_synced',
          clickup_task_id: task.id,
          clickup_task_url: task.url || null,
          clickup_synced_at: new Date().toISOString(),
          clickup_sync_error: null,
        }
      : {
          status: 'clickup_synced',
        };

    const { error: updateError } = await supabase
      .from('feedback')
      .update(updatePayload)
      .eq('id', row.id);

    if (updateError) throw updateError;
    console.log(`[synced] ${row.id} -> ${task.id}`);
  } catch (syncError) {
    const updatePayload = hasTrackingColumns
      ? {
          status: 'clickup_failed',
          clickup_sync_error: syncError.message || 'Unknown ClickUp error',
        }
      : {
          status: 'clickup_failed',
        };

    await supabase
      .from('feedback')
      .update(updatePayload)
      .eq('id', row.id);
    console.error(`[failed] ${row.id}: ${syncError.message}`);
  }
}
