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
    throw new Error(payload?.err || payload?.message || `ClickUp returned ${response.status}`);
  }

  return {
    id: payload.id,
    url: payload.url,
    raw: payload,
  };
}

export async function createClickUpFeedbackTask(feedback) {
  return createClickUpTask({
    name: taskNameForFeedback(feedback),
    markdown_content: taskDescriptionForFeedback(feedback),
    tags: tagsForFeedback(),
  });
}

function taskNameForOnboardingRequest(request) {
  const org = compact(request.organization_name) || 'New district';
  return `[Trial onboarding] ${org}`;
}

function formatConfirmedProfile(profile = {}) {
  const lines = [
    `Mission / vision / values:\n${profile.mission_vision_values || 'Needs review'}`,
    '',
    `Strategic priorities / focus areas:\n${profile.strategic_priorities || 'Needs review'}`,
    '',
    `Official social handles:\n${profile.social_handles || 'None confirmed'}`,
    '',
    `Keywords / nicknames / mascots:\n${profile.keywords || 'None confirmed'}`,
    '',
    `School names:\n${profile.school_names || 'None confirmed'}`,
    '',
    `Known exclusions / lookalikes:\n${profile.known_exclusions || 'None confirmed'}`,
    '',
    `Customer confirmation notes:\n${profile.discovery_notes || 'None'}`,
  ];
  return lines.join('\n');
}

function taskDescriptionForOnboardingRequest(request) {
  return [
    '## 30-day trial onboarding request',
    '',
    '### Contact',
    `Name: ${request.contact_name || 'Unknown'}`,
    `Email: ${request.contact_email || 'Unknown'}`,
    `Title: ${request.contact_title || 'Unknown'}`,
    '',
    '### District / organization',
    `Organization: ${request.organization_name || 'Unknown'}`,
    `Website: ${request.website || 'Unknown'}`,
    `Location: ${[request.city, request.state, request.zip].filter(Boolean).join(', ') || 'Unknown'}`,
    '',
    '### Setup inputs',
    `Social handles / URLs:\n${request.social_handles || 'None provided'}`,
    '',
    `Keywords / nicknames / mascots:\n${request.keywords || 'None provided'}`,
    '',
    `School names:\n${request.school_names || 'None provided'}`,
    '',
    `Known exclusions / lookalikes:\n${request.known_exclusions || 'None provided'}`,
    '',
    `Current monitoring provider:\n${request.current_monitoring || 'None provided'}`,
    '',
    `Notes:\n${request.notes || 'None provided'}`,
    '',
    '### Customer-confirmed setup draft',
    formatConfirmedProfile(request.confirmed_profile || {}),
    '',
    '---',
    `Onboarding request ID: ${request.id || 'Not stored yet'}`,
    `Submitted: ${request.created_at || new Date().toISOString()}`,
    '',
    '### Intended workflow',
    '1. Auto-discover mission/vision/values, strategic plan language, official handles, schools, additive signals, and lookalike exclusions.',
    '2. Admin reviews/edits discovered setup.',
    '3. Customer confirms strategic language and handles if needed.',
    '4. Canary runs clean-results test/backfill.',
    '5. Admin creates login and starts 30-day trial.',
    '6. Payment/Stripe is handled before day 30; access can be suspended if unpaid.',
  ].join('\n');
}

function tagsForOnboardingRequest() {
  const configured = process.env.CLICKUP_ONBOARDING_TAGS;
  if (!configured) return ['trial-onboarding', 'canary-data'];
  return configured
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export async function createClickUpOnboardingTask(request) {
  return createClickUpTask({
    name: taskNameForOnboardingRequest(request),
    markdown_content: taskDescriptionForOnboardingRequest(request),
    tags: tagsForOnboardingRequest(),
  });
}
