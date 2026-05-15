const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

function getConfig() {
  const token = process.env.CLICKUP_API_TOKEN;
  const listId = process.env.CLICKUP_LIST_ID;

  if (!token || !listId) return null;
  return { token, listId };
}

export function isClickUpConfigured() {
  return Boolean(getConfig());
}

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

  if (feedback.photo_url) {
    lines.push(`Screenshot: ${feedback.photo_url}`);
  }

  return lines.join('\n');
}

function tagsForFeedback() {
  const configured = process.env.CLICKUP_FEEDBACK_TAGS;
  if (!configured) return ['site-feedback', 'canary-data'];
  return configured
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export async function createClickUpFeedbackTask(feedback) {
  const config = getConfig();
  if (!config) return null;

  const response = await fetch(`${CLICKUP_API_BASE}/list/${config.listId}/task`, {
    method: 'POST',
    headers: {
      Authorization: config.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: taskNameForFeedback(feedback),
      markdown_content: taskDescriptionForFeedback(feedback),
      tags: tagsForFeedback(),
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

  return {
    id: payload.id,
    url: payload.url,
    raw: payload,
  };
}
