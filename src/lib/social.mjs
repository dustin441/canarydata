const SOCIAL_PLATFORMS = new Set(['facebook', 'instagram', 'tiktok', 'twitter', 'x', 'youtube', 'threads', 'linkedin']);

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function conciseText(value, maxLength) {
  const text = String(value || '')
    .replace(/\\[nrt]/gi, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length <= maxLength) return text;
  const candidate = text.slice(0, maxLength - 1);
  const lastSpace = candidate.lastIndexOf(' ');
  const trimmed = lastSpace >= Math.floor(maxLength * 0.7) ? candidate.slice(0, lastSpace) : candidate;
  return `${trimmed.trimEnd()}…`;
}

export function safeSocialUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeRelationship(value) {
  const relationship = String(value || '').toLowerCase();
  if (relationship === 'owned') return 'owned';
  if (['direct', 'tagged', 'mentioned', 'direct_tag', 'direct_mention', 'comment'].includes(relationship)) return 'direct';
  return 'ambient';
}

export function socialRelationshipLabel(value) {
  const relationship = normalizeRelationship(value);
  if (relationship === 'owned') return 'Published by district';
  if (relationship === 'direct') return 'Direct engagement';
  return 'Public mention';
}

export function normalizeSocialResult(item = {}) {
  const rawPlatform = String(item.platform || item.source_type || 'social').toLowerCase();
  const platform = rawPlatform === 'twitter' ? 'x' : rawPlatform;
  const relationshipType = normalizeRelationship(item.relationship_type);
  const commentCount = numberOrZero(item.comment_count);
  const replyCount = numberOrZero(item.reply_count);
  const reactionCount = numberOrZero(item.reaction_count);
  const shareCount = numberOrZero(item.share_count);
  const viewCount = numberOrZero(item.view_count);
  const calculatedEngagement = commentCount + replyCount + reactionCount + shareCount;
  const date = item.published_at || item.date || item.created_at || null;

  return {
    id: item.id || item.external_thread_id || item.canonical_url || item.link,
    districtId: item.district_id || null,
    platform: SOCIAL_PLATFORMS.has(platform) ? platform : rawPlatform,
    relationshipType,
    relationshipLabel: socialRelationshipLabel(relationshipType),
    authorName: item.author_name || item.author_handle || item.source || null,
    authorHandle: item.author_handle || null,
    headline: conciseText(item.headline || item.body || 'Social conversation', 220),
    summary: conciseText(item.summary || item.body || '', 420),
    url: safeSocialUrl(item.canonical_url || item.link || item.permalink),
    date,
    commentCount,
    replyCount,
    reactionCount,
    shareCount,
    viewCount,
    engagementTotal: numberOrZero(item.engagement_total) || calculatedEngagement,
    canaryScore: item.canary_score ?? null,
    riskLevel: item.risk_level || null,
    sentiment: item.sentiment || null,
    matchReason: conciseText(item.match_reason || (relationshipType === 'ambient' ? 'Matched a configured district social query.' : ''), 220),
    recommendation: conciseText(item.recommendation || '', 320),
    tags: Array.isArray(item.tags) ? item.tags : [],
    externalThreadId: item.external_thread_id || null,
    visibilityStatus: item.visibility_status || 'active',
  };
}

export function buildSocialResults(items = []) {
  const seen = new Set();
  return items
    .map(normalizeSocialResult)
    .filter((item) => item.id && item.platform)
    .filter((item) => {
      const key = `${item.platform}:${item.externalThreadId || item.id || item.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

export function summarizeSocialResults(items = []) {
  return items.reduce((summary, item) => {
    summary.total += 1;
    if (item.relationshipType === 'owned') summary.owned += 1;
    else if (item.relationshipType === 'direct') summary.direct += 1;
    else summary.ambient += 1;
    summary.totalEngagement += numberOrZero(item.engagementTotal);
    return summary;
  }, { total: 0, owned: 0, direct: 0, ambient: 0, totalEngagement: 0 });
}
