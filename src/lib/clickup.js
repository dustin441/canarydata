import { buildOnboardingTask } from './onboardingClickup.mjs';

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

function getConfig() {
  const token = process.env.CANARY_CLICKUP_API_TOKEN || process.env.CLICKUP_API_TOKEN;
  const listId = process.env.CANARY_CLICKUP_LIST_ID || process.env.CLICKUP_LIST_ID;

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
  if (String(feedback.message || '').startsWith('Light demo/sign-up lead submitted.')) return `[Demo lead] ${district}`;
  return `[Site feedback] ${district}${summary ? `: ${summary}` : ''}`;
}

function taskDescriptionForFeedback(feedback) {
  const lines = [
    String(feedback.message || '').startsWith('Light demo/sign-up lead submitted.') ? '## Demo/sign-up lead' : '## Site feedback',
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

function tagsForFeedback(feedback) {
  if (String(feedback.message || '').startsWith('Light demo/sign-up lead submitted.')) {
    const configured = process.env.CLICKUP_LEAD_TAGS;
    return configured ? configured.split(',').map((tag) => tag.trim()).filter(Boolean) : ['lead-request', 'canary-data'];
  }
  const configured = process.env.CLICKUP_FEEDBACK_TAGS;
  if (!configured) return ['site-feedback', 'canary-data'];
  return configured
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function createClickUpTask({ name, markdown_content, tags }) {
  const config = getConfig();
  if (!config) return null;

  const response = await fetch(`${CLICKUP_API_BASE}/list/${config.listId}/task`, {
    method: 'POST',
    headers: {
      Authorization: config.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      markdown_content,
      tags,
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

  return {
    id: payload.id,
    url: payload.url,
    raw: payload,
  };
}

export function buildFeedbackTask(feedback) {
  return {
    name: taskNameForFeedback(feedback),
    markdown_content: taskDescriptionForFeedback(feedback),
    tags: tagsForFeedback(feedback),
  };
}

export async function createClickUpFeedbackTask(feedback) {
  return createClickUpTask(buildFeedbackTask(feedback));
}

function formatQueryReviewValue(query) {
  if (!query) return 'None';
  return [
    `Query: ${query.query_text || 'None'}`,
    `Channel: ${query.channels || 'news'}`,
    `Location: ${[query.geo_city, query.geo_state, query.geo_zip].filter(Boolean).join(', ') || 'None'}`,
    `Active in customer request list: ${query.active === false ? 'No' : 'Yes'}`,
  ].join('\n');
}

export function buildQueryReviewTask(review) {
  const district = compact(review.district_name || review.district_id) || 'Unknown district';
  const action = compact(review.action || 'change').toLowerCase();
  const summaryQuery = compact(review.after?.query_text || review.before?.query_text).slice(0, 90);
  const configured = process.env.CLICKUP_QUERY_REVIEW_TAGS;
  const tags = configured
    ? configured.split(',').map((tag) => tag.trim()).filter(Boolean)
    : ['query-review', 'customer-request', 'canary-data'];

  return {
    name: `[Query activation review] ${district}: ${action}${summaryQuery ? ` · ${summaryQuery}` : ''}`,
    markdown_content: [
      '## Customer query activation review',
      '',
      `Requested action: ${action}`,
      `District: ${district}`,
      `District ID: ${review.district_id || 'Unknown'}`,
      `Customer query ID: ${review.query_id || review.after?.id || review.before?.id || 'Unknown'}`,
      `Request record ID: ${review.request_id || 'Unknown'}`,
      `Submitted: ${review.created_at || new Date().toISOString()}`,
      '',
      '### Previous customer request',
      formatQueryReviewValue(review.before),
      '',
      '### Requested customer configuration',
      formatQueryReviewValue(review.after),
      '',
      '### Activation policy',
      'This request intentionally does not modify generated_queries or canonical ingestion automatically.',
      '',
      '1. Verify district ownership, relevance, source quality, and likely false positives.',
      '2. Review the district generated_queries profile and provider configuration.',
      '3. Apply the smallest approved canonical monitoring change.',
      '4. Run a controlled ingestion and inspect retrieval, filtering, deduplication, classification, and writes.',
      '5. Verify expected final records in the district dashboard.',
      '6. Record evidence here and close the task.',
    ].join('\n'),
    tags,
  };
}

export async function createClickUpQueryReviewTask(review) {
  return createClickUpTask(buildQueryReviewTask(review));
}

export async function createClickUpOnboardingTask(request) {
  return createClickUpTask(buildOnboardingTask(request));
}

export { buildOnboardingTask };
