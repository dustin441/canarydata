const ALLOWED_PLATFORMS = new Set(['facebook', 'instagram', 'youtube', 'x', 'twitter', 'threads', 'tiktok', 'linkedin']);
const ALLOWED_RELATIONSHIPS = new Set(['owned', 'direct_tag', 'direct_mention', 'ambient']);

function nonNegativeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizePublicUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function normalizePlatform(value) {
  const platform = String(value || '').trim().toLowerCase();
  return platform === 'twitter' ? 'x' : platform;
}

function normalizeProviderItem({ provider, districtId, item }) {
  const platform = normalizePlatform(item?.platform || item?.source_type);
  if (!ALLOWED_PLATFORMS.has(platform)) throw new Error('unsupported_platform');

  const externalThreadId = String(item?.external_thread_id || item?.post_id || item?.id || '').trim();
  if (!externalThreadId) throw new Error('missing_external_thread_id');

  const canonicalUrl = normalizePublicUrl(item?.canonical_url || item?.permalink || item?.link);
  if (!canonicalUrl) throw new Error('missing_or_invalid_canonical_url');

  const relationshipType = String(item?.relationship_type || 'ambient').toLowerCase();
  if (!ALLOWED_RELATIONSHIPS.has(relationshipType)) throw new Error('invalid_relationship_type');

  const publishedAt = new Date(item?.published_at || item?.date || '');
  if (Number.isNaN(publishedAt.getTime())) throw new Error('missing_or_invalid_published_at');

  const body = String(item?.body || item?.caption || item?.summary || '').trim();
  const suppliedHeadline = String(item?.headline || '').trim();
  if (!body && !suppliedHeadline) throw new Error('missing_content');
  const headline = suppliedHeadline || body;

  const visibilityStatus = String(item?.visibility_status || 'review').toLowerCase();
  if (!['review', 'active', 'excluded'].includes(visibilityStatus)) throw new Error('invalid_visibility_status');

  const commentCount = nonNegativeNumber(item?.comment_count);
  const replyCount = nonNegativeNumber(item?.reply_count);
  const reactionCount = nonNegativeNumber(item?.reaction_count);
  const shareCount = nonNegativeNumber(item?.share_count);
  const engagementTotal = nonNegativeNumber(item?.engagement_total)
    || commentCount + replyCount + reactionCount + shareCount;

  return {
    district_id: districtId,
    provider,
    platform,
    external_thread_id: externalThreadId,
    canonical_url: canonicalUrl,
    relationship_type: relationshipType,
    author_name: item?.author_name || null,
    author_handle: item?.author_handle || null,
    headline,
    body,
    summary: item?.summary || null,
    recommendation: item?.recommendation || null,
    published_at: publishedAt.toISOString(),
    comment_count: commentCount,
    reply_count: replyCount,
    reaction_count: reactionCount,
    share_count: shareCount,
    view_count: nonNegativeNumber(item?.view_count),
    engagement_total: engagementTotal,
    sentiment: item?.sentiment || null,
    risk_level: item?.risk_level || null,
    canary_score: item?.canary_score ?? null,
    tags: Array.isArray(item?.tags) ? item.tags : [],
    strategic_alignment: Array.isArray(item?.strategic_alignment) ? item.strategic_alignment : [],
    matched_terms: Array.isArray(item?.matched_terms) ? item.matched_terms : [],
    match_reason: item?.match_reason || null,
    identity_confidence: item?.identity_confidence ?? null,
    visibility_status: visibilityStatus,
    provider_metadata: item?.provider_metadata || {},
  };
}

export function normalizeProviderBatch({ provider, districtId, items = [], providerError = null }) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedDistrictId = String(districtId || '').trim();
  if (!normalizedProvider) throw new Error('Provider is required.');
  if (!normalizedDistrictId) throw new Error('District is required.');

  if (providerError) {
    return {
      provider: normalizedProvider,
      districtId: normalizedDistrictId,
      status: 'failed',
      threads: [],
      rejected: [],
      providerErrors: 1,
      errorCode: String(providerError.code || 'PROVIDER_ERROR'),
      errorMessage: String(providerError.message || 'Social provider request failed.'),
    };
  }

  const threads = [];
  const rejected = [];
  for (const [index, item] of items.entries()) {
    try {
      threads.push(normalizeProviderItem({ provider: normalizedProvider, districtId: normalizedDistrictId, item }));
    } catch (error) {
      rejected.push({ index, reason: error.message, externalId: item?.external_thread_id || item?.post_id || item?.id || null });
    }
  }

  const status = items.length === 0
    ? 'empty'
    : rejected.length > 0
      ? (threads.length > 0 ? 'partial' : 'failed')
      : 'success';

  return {
    provider: normalizedProvider,
    districtId: normalizedDistrictId,
    status,
    threads,
    rejected,
    providerErrors: 0,
    errorCode: null,
    errorMessage: null,
  };
}
