const SOCIAL_PLATFORMS = new Set(['facebook', 'instagram', 'tiktok', 'twitter', 'x', 'youtube', 'threads', 'linkedin']);
const SOCIAL_ACTION_TYPES = new Set(['respond', 'amplify', 'strategy', 'monitor', 'elevate']);

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
    if (![
      'fbcdn.net',
      'cdninstagram.com',
      'tiktokcdn-us.com',
      'tiktokcdn.com',
      'tiktokv.us',
      'tiktokv.com',
    ].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return '';
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
  const rawRelationship = String(value || '').toLowerCase();
  const relationship = normalizeRelationship(rawRelationship);
  if (relationship === 'owned') return 'Published by district';
  if (rawRelationship === 'direct_tag' || rawRelationship === 'tagged') return 'Tagged post';
  if (rawRelationship === 'direct_mention' || rawRelationship === 'mentioned') return 'Mentioned district';
  if (rawRelationship === 'comment') return 'Public comment';
  if (relationship === 'direct') return 'Tagged / mentioned';
  return 'Public mention';
}

export function socialRelationshipFilterMatches(item = {}, filter = 'all') {
  const selected = String(filter || 'all').toLowerCase();
  if (selected === 'all') return true;
  return normalizeRelationship(item.relationshipType || item.relationship_type) === selected;
}

export function socialActionLabel(value) {
  const labels = {
    respond: 'Respond',
    amplify: 'Amplify',
    strategy: 'Strategy',
    monitor: 'Monitor',
    elevate: 'Elevate',
  };
  return labels[String(value || '').toLowerCase()] || null;
}

function conciseArray(value, maxItems = 6, maxLength = 180) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => conciseText(item, maxLength))
    .filter(Boolean))]
    .slice(0, maxItems);
}

function normalizeActionIntelligence(value, fallbackRecommendation = '') {
  if (!value || typeof value !== 'object') return null;
  const actionType = String(value.action_type || value.actionType || '').toLowerCase();
  if (!SOCIAL_ACTION_TYPES.has(actionType)) return null;
  const rawConfidence = value.confidence;
  const confidence = rawConfidence === null || rawConfidence === undefined || rawConfidence === ''
    ? null
    : Number(rawConfidence);
  return {
    actionType,
    actionLabel: socialActionLabel(actionType),
    urgency: conciseText(value.urgency || 'routine', 30),
    audiences: conciseArray(value.audiences, 6, 60),
    situationSummary: conciseText(value.situation_summary || value.situationSummary, 360),
    actionRationale: conciseText(value.action_rationale || value.actionRationale, 420),
    recommendedAction: conciseText(value.recommended_action || value.recommendedAction || fallbackRecommendation, 420),
    draftResponse: conciseText(value.draft_response || value.draftResponse, 700),
    contentOpportunity: conciseText(value.content_opportunity || value.contentOpportunity, 420),
    strategicPriorityIds: conciseArray(value.strategic_priority_ids || value.strategicPriorityIds, 6, 80),
    strategicPriorityLabels: conciseArray(value.strategic_priority_labels || value.strategicPriorityLabels, 6, 240),
    strategicAlignmentReason: conciseText(value.strategic_alignment_reason || value.strategicAlignmentReason, 500),
    missionOrValueEvidence: conciseArray(value.mission_or_value_evidence || value.missionOrValueEvidence, 6, 360),
    factsToVerify: conciseArray(value.facts_to_verify || value.factsToVerify, 8, 280),
    confidence: confidence !== null && Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    reviewStatus: value.review_status === 'approved' ? 'approved' : 'review',
    modelVersion: conciseText(value.model_version || value.modelVersion, 80),
    generatedAt: value.generated_at || value.generatedAt || null,
  };
}

export function socialActionFilterMatches(item = {}, filter = 'all') {
  const selected = String(filter || 'all').toLowerCase();
  if (selected === 'all') return true;
  return (item.actionType || item.actionIntelligence?.actionType || null) === selected;
}

export function summarizeSocialActions(items = []) {
  return items.reduce((summary, item) => {
    const actionType = item?.actionType || item?.actionIntelligence?.actionType;
    if (!SOCIAL_ACTION_TYPES.has(actionType)) return summary;
    summary.total += 1;
    summary[actionType] += 1;
    return summary;
  }, { total: 0, respond: 0, amplify: 0, strategy: 0, monitor: 0, elevate: 0 });
}

export function normalizeSocialResult(item = {}) {
  const rawPlatform = String(item.platform || item.source_type || 'social').toLowerCase();
  const platform = rawPlatform === 'twitter' ? 'x' : rawPlatform;
  const rawRelationshipType = String(item.relationship_type || '').toLowerCase();
  const relationshipType = normalizeRelationship(rawRelationshipType);
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
  const actionIntelligence = normalizeActionIntelligence(providerMetadata.action_intelligence, item.recommendation);
  const suppliedAvailability = providerMetadata.metric_availability && typeof providerMetadata.metric_availability === 'object'
    ? providerMetadata.metric_availability
    : {};
  const providerHasPerformance = Boolean(item.provider && item.provider !== 'legacy_canary_replay');
  const authorHandle = String(item.author_handle || '').replace(/^@/, '').trim();
  const suppliedAuthorProfileUrl = safeSocialUrl(item.author_profile_url || providerMetadata.author_profile_url);
  const derivedInstagramProfileUrl = platform === 'instagram' && /^[a-z0-9._]+$/i.test(authorHandle)
    ? `https://www.instagram.com/${authorHandle}/`
    : null;
  const metricAvailability = {
    reactions: Object.hasOwn(suppliedAvailability, 'reactions') ? Boolean(suppliedAvailability.reactions) : providerHasPerformance,
    comments: Object.hasOwn(suppliedAvailability, 'comments') ? Boolean(suppliedAvailability.comments) : providerHasPerformance,
    shares: Object.hasOwn(suppliedAvailability, 'shares') ? Boolean(suppliedAvailability.shares) : providerHasPerformance,
    views: Object.hasOwn(suppliedAvailability, 'views') ? Boolean(suppliedAvailability.views) : providerHasPerformance,
  };
  const representativeComments = (Array.isArray(item.social_comments) ? item.social_comments : [])
    .filter((comment) => comment?.is_representative !== false && String(comment?.body || '').trim())
    .slice(0, 3)
    .map((comment) => ({
      id: comment.id || null,
      authorName: conciseText(comment.author_name || 'Public commenter', 80),
      body: conciseText(comment.body, 280),
      date: comment.published_at || null,
      reactionCount: numberOrZero(comment.reaction_count),
    }));

  return {
    id: item.id || item.external_thread_id || item.canonical_url || item.link,
    districtId: item.district_id || null,
    platform: SOCIAL_PLATFORMS.has(platform) ? platform : rawPlatform,
    relationshipType,
    relationshipLabel: socialRelationshipLabel(rawRelationshipType || relationshipType),
    rawRelationshipType,
    authorName: item.author_name || item.author_handle || item.source || null,
    authorHandle: item.author_handle || null,
    authorProfileUrl: suppliedAuthorProfileUrl || derivedInstagramProfileUrl,
    headline: conciseText(item.headline || item.body || 'Social conversation', 220),
    summary: conciseText(item.summary || item.body || '', 420),
    url: safeSocialUrl(item.canonical_url || item.link || item.permalink),
    mediaUrl: safeSocialMediaUrl(item.media_url || providerMetadata.media_url),
    videoUrl: safeSocialMediaUrl(item.video_url || providerMetadata.video_url),
    profileImageUrl: safeSocialMediaUrl(item.profile_picture_url || providerMetadata.profile_picture_url),
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
    mediaType: conciseText(providerMetadata.media_type || providerMetadata.post_type || item.media_type || '', 40) || null,
    isTextOnly: Boolean(providerMetadata.is_text_only) || providerMetadata.media_type === 'text',
    isSharedPost: Boolean(providerMetadata.shared_post),
    carouselCount: Math.max(0, Number(providerMetadata.carousel_count) || 0),
    providerMetadata,
    metricAvailability,
    hasPerformanceData: Object.values(metricAvailability).some(Boolean),
    representativeComments,
    actionType: actionIntelligence?.actionType || null,
    actionIntelligence,
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
