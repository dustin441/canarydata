const SOCIAL_CORRECTION_ACTIONS = new Set(['exclude', 'restore']);
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function requireSocialCorrectionExpectedVersion(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Expected review version must be a non-negative integer.');
  }
  return value;
}

function requireIdentifier(value, label) {
  const identifier = String(value || '').trim();
  if (!identifier) throw new Error(`${label} is required.`);
  return identifier;
}

export function buildSocialCorrectionIdempotencyKey({ socialThreadId, action, expectedVersion }) {
  const threadId = requireIdentifier(socialThreadId, 'Social result');
  if (!SOCIAL_CORRECTION_ACTIONS.has(action)) throw new Error('Unsupported social correction action.');
  const version = requireSocialCorrectionExpectedVersion(expectedVersion);
  const key = `social:${threadId}:${action}:v${version}`;
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new Error('Social correction idempotency key must be 8 to 128 URL-safe characters.');
  }
  return key;
}

export function buildSocialCorrectionRpcArgs({ actorId, districtId, socialThreadId, action, expectedVersion }) {
  const version = requireSocialCorrectionExpectedVersion(expectedVersion);
  const threadId = requireIdentifier(socialThreadId, 'Social result');
  return {
    p_actor_user_id: requireIdentifier(actorId, 'Actor'),
    p_expected_district_id: requireIdentifier(districtId, 'Expected district'),
    p_social_thread_id: threadId,
    p_action: action,
    p_expected_version: version,
    p_idempotency_key: buildSocialCorrectionIdempotencyKey({ socialThreadId: threadId, action, expectedVersion: version }),
  };
}
