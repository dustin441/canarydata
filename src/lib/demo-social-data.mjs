import { OWNED_DEMO_SOCIAL_FIXTURES, PUBLIC_DEMO_SOCIAL_FIXTURES } from './demo-social-fixture-source.mjs';

const DAY_MS = 86_400_000;
const DISTRICT_ID = 'canary-falls-usd';
const DISTRICT_NAME = 'Canary Falls Unified School District';
const LATEST_SOURCE_PUBLISHED_AT = Math.max(...OWNED_DEMO_SOCIAL_FIXTURES.map((post) => new Date(post.sourcePublishedAt).getTime()));

function anchorTimestamp(asOf) {
  const date = new Date(asOf ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new TypeError('Demo Social asOf must be a valid date.');
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 15, 30, 0, 0);
}

function iso(timestamp) {
  return new Date(timestamp).toISOString();
}

function utcDate(timestamp) {
  return iso(timestamp).slice(0, 10);
}

function demoPostPath(postId) {
  return `/demo/social/${encodeURIComponent(postId)}`;
}

function nativeMetric(value, name, publishedAt, observedAt, sourceScope = 'total') {
  return {
    value,
    availability: 'available',
    sourceScope,
    providerMetricName: `demo_${name}`,
    normalizedMetricName: name,
    metricVariant: 'demo',
    period: 'lifetime',
    periodStartAt: publishedAt,
    periodEndAt: observedAt,
    effectiveAt: observedAt,
    observedAt,
  };
}

function ownedThread(fixture, anchorMs) {
  const sourceDelta = LATEST_SOURCE_PUBLISHED_AT - new Date(fixture.sourcePublishedAt).getTime();
  const publishedAt = iso(anchorMs - DAY_MS - sourceDelta);
  const observedAt = iso(anchorMs);
  const socialAccountId = fixture.platform === 'facebook' ? 'demo-social-facebook' : 'demo-social-instagram';
  const views = fixture.videoViews > 0 ? fixture.videoViews : fixture.impressions;
  const comparableInteractions = fixture.reactions + fixture.comments + fixture.shares;
  return {
    id: `demo-thread-${fixture.postId.toLowerCase()}`,
    district_id: DISTRICT_ID,
    social_account_id: socialAccountId,
    platform: fixture.platform,
    provider: 'demo_fixture',
    external_thread_id: fixture.postId,
    canonical_url: demoPostPath(fixture.postId),
    relationship_type: 'owned',
    author_name: DISTRICT_NAME,
    author_handle: 'canaryfallsusd',
    headline: fixture.copy,
    summary: fixture.copy,
    body: fixture.copy,
    published_at: publishedAt,
    media_url: `/demo-social/${fixture.asset}`,
    media_type: fixture.mediaType,
    reaction_count: fixture.reactions,
    comment_count: fixture.comments,
    reply_count: 0,
    share_count: fixture.shares,
    view_count: views,
    engagement_total: comparableInteractions,
    sentiment: 'positive',
    match_reason: `Official ${fixture.platform} post · ${fixture.contentTheme}`,
    recommendation: fixture.isTopPost ? 'Use this high-performing example as a leadership highlight.' : 'Retain as part of the official publishing record.',
    visibility_status: 'active',
    tags: [fixture.contentTheme, fixture.contentType, fixture.isTopPost ? 'Top Post' : 'Official Social'].filter(Boolean),
    provider_metadata: {
      demo_fixture: true,
      demo_source_published_at: fixture.sourcePublishedAt,
      content_theme: fixture.contentTheme,
      content_type: fixture.contentType,
      media_type: fixture.mediaType,
      carousel_count: fixture.carouselCount,
      is_top_post: fixture.isTopPost,
      top_post_rank: fixture.topPostRank,
      followers_count: fixture.platform === 'facebook' ? 18_700 : 12_850,
      reach: fixture.reach,
      impressions: fixture.impressions,
      link_clicks: fixture.linkClicks,
      saves: fixture.saves,
      metric_availability: { reactions: true, comments: true, shares: true, views: true },
      native_interaction_coverage: 'complete',
      native_metrics: {
        views: nativeMetric(views, 'views', publishedAt, observedAt),
        uniqueViewers: nativeMetric(fixture.reach, 'reach', publishedAt, observedAt),
        clicks: nativeMetric(fixture.linkClicks, 'clicks', publishedAt, observedAt),
        reactions: nativeMetric(fixture.reactions, 'reactions', publishedAt, observedAt),
        comments: nativeMetric(fixture.comments, 'comments', publishedAt, observedAt),
        shares: nativeMetric(fixture.shares, 'shares', publishedAt, observedAt),
        saves: nativeMetric(fixture.saves, 'saves', publishedAt, observedAt),
        reposts: nativeMetric(0, 'reposts', publishedAt, observedAt),
        totalInteractions: nativeMetric(fixture.engagements, 'total_interactions', publishedAt, observedAt),
      },
    },
  };
}

function publicRecommendation(fixture) {
  if (fixture.actionType === 'amplify') return 'Consider amplifying this community validation from an official district channel.';
  if (fixture.postId === 'PC-007') return 'Verify the situation with district safety staff and monitor for rumor growth before responding.';
  if (fixture.postId === 'PC-011') return 'Prepare a direct, factual schedule-change explainer before the discussion is amplified further.';
  if (fixture.actionType === 'respond') return 'Acknowledge the concern and publish a concise, verified operational response.';
  return 'Monitor for meaningful district impact; no immediate response is required.';
}

function publicThread(fixture, anchorMs) {
  const publishedAt = iso(anchorMs - ((fixture.relativeDayOffset + 1) * DAY_MS) - ((fixture.relativeDayOffset % 3) * 45 * 60 * 1000));
  const recommendation = publicRecommendation(fixture);
  return {
    id: `demo-thread-${fixture.postId.toLowerCase()}`,
    district_id: DISTRICT_ID,
    social_account_id: null,
    platform: fixture.platform,
    provider: 'demo_fixture',
    external_thread_id: fixture.postId,
    canonical_url: demoPostPath(fixture.postId),
    relationship_type: 'ambient',
    author_name: fixture.authorName,
    author_handle: fixture.authorHandle,
    headline: fixture.copy,
    summary: fixture.copy,
    body: fixture.copy,
    published_at: publishedAt,
    media_url: fixture.asset ? `/demo-social/${fixture.asset}` : null,
    media_type: fixture.mediaType,
    reaction_count: fixture.reactions,
    comment_count: fixture.comments,
    reply_count: 0,
    share_count: fixture.shares,
    view_count: 0,
    engagement_total: fixture.reactions + fixture.comments + fixture.shares,
    sentiment: fixture.sentiment,
    risk_level: fixture.actionType === 'respond' ? 'high' : fixture.actionType === 'monitor' ? 'medium' : 'low',
    match_reason: fixture.signal,
    recommendation,
    visibility_status: 'active',
    tags: ['Public Conversation', fixture.rawSentiment],
    provider_metadata: {
      demo_fixture: true,
      source_label: fixture.sourceLabel,
      media_type: fixture.mediaType,
      is_text_only: fixture.mediaType === 'text',
      metric_availability: { reactions: true, comments: true, shares: true, views: false },
      native_interaction_coverage: 'complete',
      action_intelligence: {
        action_type: fixture.actionType,
        urgency: fixture.urgency,
        situation_summary: fixture.signal,
        action_rationale: `The fictional demo signal is classified as ${fixture.rawSentiment.toLowerCase()} and has ${fixture.engagements.toLocaleString('en-US')} public interactions.`,
        recommended_action: recommendation,
        strategic_priority_labels: ['Family and Community Trust'],
        strategic_alignment_reason: 'Timely, factual communication supports trust in the fictional district demo profile.',
        confidence: 0.92,
        review_status: 'review',
        model_version: 'demo-fixture-v1',
        generated_at: iso(anchorMs),
      },
    },
  };
}

function dailySeries(anchorMs) {
  const series = [];
  const accounts = [
    { accountKey: 'demo-social-facebook', platform: 'facebook', name: 'Canary Falls Unified School District', handle: 'canaryfallsusd', metrics: { views: [3_050, 18], engagements: [205, 1.8] } },
    { accountKey: 'demo-social-instagram', platform: 'instagram', name: 'Canary Falls Unified School District', handle: 'canaryfallsusd', metrics: { reach: [2_300, 15], total_interactions: [165, 1.6], follower_change: [7, 0.08] } },
  ];
  for (const account of accounts) {
    for (let index = 0; index < 60; index += 1) {
      const age = 59 - index;
      const date = utcDate(anchorMs - (age * DAY_MS));
      for (const [metric, [base, slope]] of Object.entries(account.metrics)) {
        const weeklyVariation = ((index % 7) - 3) * (metric === 'follower_change' ? 0.2 : 8);
        series.push({
          accountKey: account.accountKey,
          accountIdentity: { name: account.name, handle: account.handle, profileUrl: demoPostPath(account.accountKey) },
          platform: account.platform,
          metric,
          period: 'day',
          date,
          value: Math.max(0, Math.round(base + (index * slope) + weeklyVariation)),
        });
      }
    }
  }
  return series;
}

function metricSummary(value, name, anchorMs, period, days) {
  const end = anchorMs;
  const start = anchorMs - ((days - 1) * DAY_MS);
  return {
    value,
    availability: 'available',
    sourceScope: 'total',
    providerMetricName: `demo_${name}`,
    normalizedMetricName: name,
    metricVariant: name === 'reach' ? 'time_series' : 'total_value',
    period,
    periodStartAt: iso(start),
    periodEndAt: iso(end),
    effectiveAt: iso(end),
    observedAt: iso(end),
  };
}

function accountMetricSummary(anchorMs, history) {
  const recent = (accountKey, metric, days) => history
    .filter((row) => row.accountKey === accountKey && row.metric === metric)
    .slice(-days)
    .reduce((sum, row) => sum + row.value, 0);
  const facebook = {
    accountKey: 'facebook:canaryfallsusd', platform: 'facebook', accountName: DISTRICT_NAME, accountHandle: 'canaryfallsusd', accountProfileUrl: demoPostPath('demo-social-facebook'),
    views: metricSummary(recent('demo-social-facebook', 'views', 28), 'views', anchorMs, 'days_28', 28),
    uniqueViewers: metricSummary(Math.round(recent('demo-social-facebook', 'views', 28) * 0.74), 'unique_viewers', anchorMs, 'days_28', 28),
    engagements: metricSummary(recent('demo-social-facebook', 'engagements', 28), 'engagements', anchorMs, 'days_28', 28),
    reach: null, totalInteractions: null, profileViews: null, profileLinkTaps: null, websiteClicks: null, netFollowerChange: null,
  };
  const instagramReach = history.filter((row) => row.accountKey === 'demo-social-instagram' && row.metric === 'reach').at(-1)?.value ?? 0;
  const instagramInteractions = recent('demo-social-instagram', 'total_interactions', 7);
  const instagramFollows = recent('demo-social-instagram', 'follower_change', 7);
  const instagram = {
    accountKey: 'instagram:canaryfallsusd', platform: 'instagram', accountName: DISTRICT_NAME, accountHandle: 'canaryfallsusd', accountProfileUrl: demoPostPath('demo-social-instagram'),
    views: metricSummary(Math.round(instagramReach * 1.24), 'views', anchorMs, 'week', 7),
    uniqueViewers: null, engagements: null,
    reach: metricSummary(instagramReach, 'reach', anchorMs, 'day', 1),
    totalInteractions: metricSummary(instagramInteractions, 'total_interactions', anchorMs, 'week', 7),
    profileViews: metricSummary(1_248, 'profile_views', anchorMs, 'week', 7),
    profileLinkTaps: metricSummary(186, 'profile_links_taps', anchorMs, 'week', 7),
    websiteClicks: metricSummary(114, 'website_clicks', anchorMs, 'week', 7),
    netFollowerChange: { ...metricSummary(instagramFollows, 'follower_change', anchorMs, 'week', 7), follows: instagramFollows + 18, unfollows: 18 },
  };
  return {
    accounts: [facebook, instagram],
    platforms: { facebook, instagram },
    combinedReachOrViewers: null,
    platformCount: 2,
    accountCount: 2,
  };
}

export function buildDemoSocialData(asOf = new Date()) {
  const anchorMs = anchorTimestamp(asOf);
  const history = dailySeries(anchorMs);
  return {
    reportAsOf: iso(anchorMs),
    socialThreads: [
      ...OWNED_DEMO_SOCIAL_FIXTURES.map((fixture) => ownedThread(fixture, anchorMs)),
      ...PUBLIC_DEMO_SOCIAL_FIXTURES.map((fixture) => publicThread(fixture, anchorMs)),
    ],
    socialAccountMetricSummaries: { [DISTRICT_ID]: accountMetricSummary(anchorMs, history) },
    socialPerformanceHistory: { [DISTRICT_ID]: history },
  };
}

export function findDemoSocialPost(postId, asOf = new Date()) {
  const normalized = decodeURIComponent(String(postId || '')).toUpperCase();
  return buildDemoSocialData(asOf).socialThreads.find((post) => post.external_thread_id === normalized) || null;
}
