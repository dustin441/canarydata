export const SOCIAL_DISCOVERY_BATCH_LIMIT = 25;

const RISK_PATTERN = /\b(active shooter|arrest(?:ed)?|assault(?:ed)?|abuse|bully(?:ing)?|crisis|death|died|discrimination|emergency|gun|harassment|investigation|lawsuit|lockdown|misconduct|racism|shooting|threat(?:en(?:ed|ing)?)?|unsafe|weapon)\b/i;
const HIGH_URGENCY = new Set(['critical', 'high', 'urgent', 'immediate']);

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function payload(candidate = {}) {
  return candidate.candidate_payload && typeof candidate.candidate_payload === 'object'
    ? candidate.candidate_payload
    : {};
}

export function socialDiscoveryAuthor(candidate = {}) {
  const item = payload(candidate);
  return String(item.author_name || item.author_handle || 'Unknown author').replace(/^@/, '').trim() || 'Unknown author';
}

export function socialDiscoveryEngagement(candidate = {}) {
  const item = payload(candidate);
  return ['reaction_count', 'comment_count', 'reply_count', 'share_count', 'view_count']
    .reduce((total, key) => total + numberOrZero(item[key]), 0);
}

export function socialDiscoveryConfidence(candidate = {}) {
  const item = payload(candidate);
  const raw = item.identity_confidence ?? item.confidence_score ?? item.confidence
    ?? item.provider_metadata?.identity_confidence ?? item.provider_metadata?.confidence;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const normalized = value > 1 && value <= 100 ? value / 100 : value;
  return Math.max(0, Math.min(1, normalized));
}

export function socialDiscoveryConfidenceBand(candidate = {}) {
  const confidence = socialDiscoveryConfidence(candidate);
  if (confidence === null) return 'unknown';
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

export function socialDiscoveryAgeHours(candidate = {}, nowValue = Date.now()) {
  const item = payload(candidate);
  const publishedAt = Date.parse(item.published_at || candidate.first_seen_at || candidate.last_seen_at || '');
  const now = typeof nowValue === 'number' ? nowValue : Date.parse(nowValue);
  if (!Number.isFinite(publishedAt) || !Number.isFinite(now)) return null;
  return Math.max(0, (now - publishedAt) / 3_600_000);
}

export function socialDiscoveryPriority(candidate = {}) {
  const item = payload(candidate);
  const text = `${item.headline || ''} ${item.body || ''}`;
  const urgency = String(item.provider_metadata?.action_intelligence?.urgency || '').toLowerCase();
  if (RISK_PATTERN.test(text) || HIGH_URGENCY.has(urgency)) return 'urgent';
  if (socialDiscoveryEngagement(candidate) >= 100 || ['direct', 'direct_tag', 'direct_mention', 'tagged', 'mentioned'].includes(String(candidate.relationship_type || '').toLowerCase())) return 'high';
  return 'standard';
}

const PRIORITY_WEIGHT = { urgent: 3, high: 2, standard: 1 };

export function rankSocialDiscoveryCandidates(candidates = []) {
  return [...candidates].sort((left, right) => {
    const priorityDifference = PRIORITY_WEIGHT[socialDiscoveryPriority(right)] - PRIORITY_WEIGHT[socialDiscoveryPriority(left)];
    if (priorityDifference) return priorityDifference;
    const engagementDifference = socialDiscoveryEngagement(right) - socialDiscoveryEngagement(left);
    if (engagementDifference) return engagementDifference;
    const rightDate = Date.parse(payload(right).published_at || right.last_seen_at || 0) || 0;
    const leftDate = Date.parse(payload(left).published_at || left.last_seen_at || 0) || 0;
    return rightDate - leftDate;
  });
}

export function filterSocialDiscoveryCandidates(candidates = [], filters = {}) {
  const priority = String(filters.priority || 'all').toLowerCase();
  const author = String(filters.author || 'all').toLowerCase();
  const platform = String(filters.platform || 'all').toLowerCase();
  const districtId = String(filters.districtId || 'all').toLowerCase();
  const confidence = String(filters.confidence || 'all').toLowerCase();
  const query = String(filters.query || '').trim().toLowerCase();
  const maxAgeDays = Number(filters.maxAgeDays);
  return candidates.filter((candidate) => (
    (priority === 'all' || socialDiscoveryPriority(candidate) === priority)
    && (author === 'all' || socialDiscoveryAuthor(candidate).toLowerCase() === author)
    && (platform === 'all' || String(candidate.platform || '').toLowerCase() === platform)
    && (districtId === 'all' || String(candidate.district_id || '').toLowerCase() === districtId)
    && (confidence === 'all' || socialDiscoveryConfidenceBand(candidate) === confidence)
    && (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0 || (socialDiscoveryAgeHours(candidate, filters.now) ?? Number.POSITIVE_INFINITY) <= maxAgeDays * 24)
    && (!query || `${payload(candidate).headline || ''} ${payload(candidate).body || ''} ${socialDiscoveryAuthor(candidate)}`.toLowerCase().includes(query))
  ));
}

export function normalizeSocialDiscoveryBatchItems(items = []) {
  if (!Array.isArray(items) || !items.length) throw new Error('Select at least one Social discovery candidate.');
  if (items.length > SOCIAL_DISCOVERY_BATCH_LIMIT) throw new Error(`Review no more than ${SOCIAL_DISCOVERY_BATCH_LIMIT} candidates at once.`);
  const normalized = items.map((item) => {
    const candidateId = String(item?.candidateId || '').trim();
    const expectedVersion = Number(item?.expectedVersion);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateId)) throw new Error('Every selected candidate must have a valid ID.');
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error('Every selected candidate must include its current version.');
    return { candidateId, expectedVersion };
  });
  if (new Set(normalized.map((item) => item.candidateId)).size !== normalized.length) throw new Error('A candidate cannot appear twice in one batch.');
  return normalized;
}
