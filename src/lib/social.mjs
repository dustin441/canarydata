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

export function safeSocialMediaUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase();
    if (!['fbcdn.net', 'cdninstagram.com'].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function calculateSocialEngagementRate(item = {}, followerCount = 0) {
  const followers = numberOrZero(followerCount);
  if (!followers) return null;
  return (numberOrZero(item.engagementTotal) / followers) * 100;
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
  const providerMetadata = item.provider_metadata && typeof item.provider_metadata === 'object'
    ? item.provider_metadata
    : {};
  const suppliedAvailability = providerMetadata.metric_availability && typeof providerMetadata.metric_availability === 'object'
    ? providerMetadata.metric_availability
    : {};
  const providerHasPerformance = Boolean(item.provider && item.provider !== 'legacy_canary_replay');
  const metricAvailability = {
    reactions: Object.hasOwn(suppliedAvailability, 'reactions') ? Boolean(suppliedAvailability.reactions) : providerHasPerformance,
    comments: Object.hasOwn(suppliedAvailability, 'comments') ? Boolean(suppliedAvailability.comments) : providerHasPerformance,
    shares: Object.hasOwn(suppliedAvailability, 'shares') ? Boolean(suppliedAvailability.shares) : providerHasPerformance,
    views: Object.hasOwn(suppliedAvailability, 'views') ? Boolean(suppliedAvailability.views) : providerHasPerformance,
  };

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
    mediaUrl: safeSocialMediaUrl(item.media_url || providerMetadata.media_url),
    videoUrl: safeSocialMediaUrl(item.video_url || providerMetadata.video_url),
    profileImageUrl: safeSocialMediaUrl(item.profile_picture_url || providerMetadata.profile_picture_url),
    mediaType: providerMetadata.media_type === 'video' ? 'video' : 'image',
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
    provider: item.provider || null,
    providerMetadata,
    metricAvailability,
    hasPerformanceData: Object.values(metricAvailability).some(Boolean),
  };
}

function socialResultKey(item) {
  if (item.url) {
    try {
      const url = new URL(item.url);
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      const path = url.pathname.replace(/\/+$/, '') || '/';
      return `${item.platform}:${host}${path}`;
    } catch {
      // safeSocialUrl already filters malformed links; fall through to provider identity.
    }
  }
  return `${item.platform}:${item.externalThreadId || item.id}`;
}

export function buildSocialResults(items = []) {
  const seen = new Set();
  return items
    .map(normalizeSocialResult)
    .filter((item) => item.id && item.platform)
    .filter((item) => {
      const key = socialResultKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

export function rankTopSocialResults(items = [], limit = 5) {
  const safeLimit = Math.max(0, Math.trunc(Number(limit) || 0));
  if (!safeLimit) return [];
  return items
    .filter((item) => item?.relationshipType === 'owned')
    .slice()
    .sort((a, b) => {
      const engagementDifference = numberOrZero(b.engagementTotal) - numberOrZero(a.engagementTotal);
      if (engagementDifference) return engagementDifference;
      const viewDifference = numberOrZero(b.viewCount) - numberOrZero(a.viewCount);
      if (viewDifference) return viewDifference;
      return String(b.date || '').localeCompare(String(a.date || ''));
    })
    .slice(0, safeLimit);
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
