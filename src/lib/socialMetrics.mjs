function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function latestRows(rows, keyFor, asOf = null) {
  const cutoff = asOf ? timestamp(asOf) : null;
  const latest = new Map();
  for (const row of rows || []) {
    const effectiveAt = timestamp(row?.effective_at);
    const observedAt = timestamp(row?.observed_at);
    if (effectiveAt === null || observedAt === null) continue;
    if (cutoff !== null && (effectiveAt > cutoff || observedAt > cutoff)) continue;
    const key = keyFor(row);
    if (!key) continue;
    const current = latest.get(key);
    const currentEffective = timestamp(current?.effective_at) ?? -1;
    const currentObserved = timestamp(current?.observed_at) ?? -1;
    if (!current || effectiveAt > currentEffective || (effectiveAt === currentEffective && observedAt > currentObserved)) latest.set(key, row);
  }
  return latest;
}

function stableMetricIdentity(row) {
  return [row?.provider_account_link_id, row?.social_thread_id, row?.provider_object_id, row?.provider_metric_name, row?.metric_variant, row?.period, row?.source_scope].map((value) => String(value ?? '')).join(':');
}

function newestRow(rows = []) {
  return [...rows].sort((a, b) => {
    const effective = (timestamp(b?.effective_at) ?? -1) - (timestamp(a?.effective_at) ?? -1);
    if (effective) return effective;
    const observed = (timestamp(b?.observed_at) ?? -1) - (timestamp(a?.observed_at) ?? -1);
    if (observed) return observed;
    return stableMetricIdentity(a).localeCompare(stableMetricIdentity(b));
  })[0] || null;
}

function sumBreakdownObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const values = Object.values(value).map(finiteValue).filter((item) => item !== null);
  return values.length ? values.reduce((sum, item) => sum + item, 0) : null;
}

function breakdownActionValue(row, aliases) {
  if (row?.availability !== 'available') return null;
  const breakdown = row?.breakdown && typeof row.breakdown === 'object' && !Array.isArray(row.breakdown) ? row.breakdown : {};
  let matched = false;
  let total = 0;
  for (const [key, value] of Object.entries(breakdown)) {
    if (!aliases.some((alias) => String(key).toLowerCase().includes(alias))) continue;
    const parsed = finiteValue(value);
    if (parsed === null) continue;
    matched = true;
    total += parsed;
  }
  if (matched) return total;
  return finiteValue(row?.metric_value) === 0 ? 0 : null;
}

function metric(row, derivedValue = undefined) {
  if (!row) return null;
  const value = derivedValue === undefined ? finiteValue(row.metric_value) : finiteValue(derivedValue);
  return {
    value: row.availability === 'available' ? value : null,
    availability: row.availability || 'unavailable',
    sourceScope: row.source_scope || 'unknown',
    providerMetricName: row.provider_metric_name || null,
    normalizedMetricName: row.normalized_metric_name || null,
    period: row.period || null,
    periodStartAt: row.period_start_at || null,
    periodEndAt: row.period_end_at || null,
    effectiveAt: row.effective_at || null,
    observedAt: row.observed_at || null,
  };
}

function available(metricValue) {
  return metricValue?.availability === 'available' && metricValue.value !== null;
}

function contentMetricsFor(thread, rows) {
  const row = (providerMetricName) => newestRow(rows.filter((candidate) => candidate.social_thread_id === thread.id && candidate.platform === thread.platform && candidate.provider_metric_name === providerMetricName));
  if (thread.platform === 'facebook') {
    const reactionsRow = row('post_reactions_by_type_total');
    const actionRow = row('post_activity_by_action_type');
    const reactionValue = finiteValue(reactionsRow?.metric_value) ?? sumBreakdownObject(reactionsRow?.breakdown);
    return {
      views: metric(row('post_media_view')),
      uniqueViewers: metric(row('post_total_media_view_unique')),
      clicks: metric(row('post_clicks')),
      reactions: metric(reactionsRow, reactionValue),
      comments: metric(actionRow, breakdownActionValue(actionRow, ['comment'])),
      shares: metric(actionRow, breakdownActionValue(actionRow, ['share'])),
      saves: null,
      reposts: null,
      totalInteractions: null,
    };
  }
  if (thread.platform === 'instagram') {
    return {
      views: metric(row('views')),
      uniqueViewers: metric(row('reach')),
      clicks: null,
      reactions: metric(row('likes')),
      comments: metric(row('comments')),
      shares: metric(row('shares')),
      saves: metric(row('saved')),
      reposts: metric(row('reposts')),
      totalInteractions: metric(row('total_interactions')),
    };
  }
  return null;
}

export function enrichSocialThreadsWithNativeMetrics(threads = [], snapshots = [], { asOf = null } = {}) {
  const contentRows = (snapshots || []).filter((row) => row?.metric_scope === 'content' && row?.social_thread_id);
  const latestContentRows = [...latestRows(contentRows, stableMetricIdentity, asOf).values()];
  return (threads || []).map((thread) => {
    const metrics = contentMetricsFor(thread, latestContentRows);
    if (!metrics) return thread;
    const providerMetadata = thread.provider_metadata && typeof thread.provider_metadata === 'object' ? thread.provider_metadata : {};
    const existingAvailability = providerMetadata.metric_availability && typeof providerMetadata.metric_availability === 'object' ? providerMetadata.metric_availability : {};
    const resolvedAvailability = (nativeMetric, field) => nativeMetric ? available(nativeMetric) : Boolean(existingAvailability[field]);
    const resolvedCount = (nativeMetric, existingCount) => nativeMetric ? (available(nativeMetric) ? nativeMetric.value : 0) : existingCount;
    const metricAvailability = {
      comments: resolvedAvailability(metrics.comments, 'comments'),
      reactions: resolvedAvailability(metrics.reactions, 'reactions'),
      shares: resolvedAvailability(metrics.shares, 'shares'),
      views: resolvedAvailability(metrics.views, 'views'),
    };
    const commentCount = resolvedCount(metrics.comments, thread.comment_count);
    const reactionCount = resolvedCount(metrics.reactions, thread.reaction_count);
    const shareCount = resolvedCount(metrics.shares, thread.share_count);
    const viewCount = resolvedCount(metrics.views, thread.view_count);
    const replyCount = metrics.comments ? 0 : thread.reply_count;
    const hasNativeInteraction = [metrics.comments, metrics.reactions, metrics.shares].some(Boolean);
    const engagementTotal = hasNativeInteraction
      ? [commentCount, replyCount, reactionCount, shareCount].map(finiteValue).filter((value) => value !== null).reduce((sum, value) => sum + value, 0)
      : thread.engagement_total;
    return {
      ...thread,
      comment_count: commentCount,
      reply_count: replyCount,
      reaction_count: reactionCount,
      share_count: shareCount,
      view_count: viewCount,
      engagement_total: engagementTotal,
      provider_metadata: {
        ...providerMetadata,
        metric_availability: metricAvailability,
        native_metrics: metrics,
      },
    };
  });
}

function utcDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function windowLabel(row, fallbackDays = null) {
  const start = timestamp(row?.period_start_at);
  const end = timestamp(row?.period_end_at);
  const ending = utcDate(row?.period_end_at || row?.effective_at);
  if (!ending) return 'Source period unavailable';
  if (start !== null && end !== null && end >= start) {
    const days = Math.max(1, Math.round((end - start) / 86_400_000));
    return `${days} days ending ${ending}`;
  }
  if (row?.period === 'days_28') return `28 days ending ${ending}`;
  if (row?.period === 'week') return `7 days ending ${ending}`;
  if (row?.period === 'day') return `Day ending ${ending}`;
  return fallbackDays ? `${fallbackDays} days ending ${ending}` : `Ending ${ending}`;
}

function netFollowsMetric(row) {
  if (!row) return null;
  const breakdowns = Array.isArray(row?.breakdown?.breakdowns) ? row.breakdown.breakdowns : [];
  const results = breakdowns.flatMap((item) => Array.isArray(item?.results) ? item.results : []);
  let followers = null;
  let unfollowers = null;
  for (const result of results) {
    const dimension = String(result?.dimension_values?.[0] || '').toUpperCase();
    if (dimension === 'FOLLOWER') followers = finiteValue(result.value);
    if (dimension === 'NON_FOLLOWER') unfollowers = finiteValue(result.value);
  }
  const value = followers === null && unfollowers === null ? null : (followers || 0) - (unfollowers || 0);
  const baseMetric = metric(row, 0);
  return { ...baseMetric, value: row.availability === 'available' && Number.isFinite(value) ? value : null, follows: followers, unfollows: unfollowers };
}

export function summarizeOwnedSocialAccountMetrics(snapshots = [], { asOf = null } = {}) {
  const accountRows = (snapshots || []).filter((row) => row?.metric_scope === 'account');
  const latest = [...latestRows(accountRows, stableMetricIdentity, asOf).values()];
  const selectedLinkByPlatform = Object.fromEntries(['facebook', 'instagram'].map((platform) => {
    const candidate = newestRow(latest.filter((row) => row.platform === platform));
    return [platform, candidate?.provider_account_link_id || null];
  }));
  const find = (platform, providerMetricName, period = null, metricVariant = null) => {
    const candidates = latest.filter((row) => row.platform === platform
      && (row.provider_account_link_id || null) === selectedLinkByPlatform[platform]
      && row.provider_metric_name === providerMetricName
      && (!period || row.period === period)
      && (!metricVariant || row.metric_variant === metricVariant));
    return newestRow(candidates);
  };
  const facebookPeriod = ['days_28', 'week', 'day'].find((period) => ['page_media_view', 'page_total_media_view_unique', 'page_post_engagements'].some((name) => find('facebook', name, period))) || null;
  const facebookViews = facebookPeriod ? find('facebook', 'page_media_view', facebookPeriod) : null;
  const facebookUniqueViewers = facebookPeriod ? find('facebook', 'page_total_media_view_unique', facebookPeriod) : null;
  const facebookEngagements = facebookPeriod ? find('facebook', 'page_post_engagements', facebookPeriod) : null;
  const facebookAnchor = facebookViews || facebookUniqueViewers || facebookEngagements;
  const facebook = facebookAnchor ? {
    windowLabel: windowLabel(facebookAnchor, 28),
    latestObservedAt: facebookAnchor.observed_at || null,
    views: metric(facebookViews),
    uniqueViewers: metric(facebookUniqueViewers),
    engagements: metric(facebookEngagements),
    reach: null,
    totalInteractions: null,
    profileViews: null,
    profileLinkTaps: null,
    websiteClicks: null,
    netFollowerChange: null,
  } : null;
  const instagramViews = find('instagram', 'views', null, 'total_value');
  const instagramReach = find('instagram', 'reach', null, 'time_series');
  const instagramInteractions = find('instagram', 'total_interactions', null, 'total_value');
  const instagramProfileViews = find('instagram', 'profile_views', null, 'total_value');
  const instagramAnchor = instagramViews || instagramInteractions || instagramProfileViews || instagramReach;
  const instagram = instagramAnchor ? {
    windowLabel: instagramAnchor === instagramReach ? `Daily value ending ${utcDate(instagramReach.effective_at)}` : windowLabel(instagramAnchor, 7),
    latestObservedAt: instagramAnchor.observed_at || null,
    views: metric(instagramViews),
    uniqueViewers: null,
    engagements: null,
    reach: metric(instagramReach),
    reachWindowLabel: instagramReach ? `Daily value ending ${utcDate(instagramReach.effective_at)}` : null,
    totalInteractions: metric(instagramInteractions),
    profileViews: metric(instagramProfileViews),
    profileLinkTaps: metric(find('instagram', 'profile_links_taps', null, 'total_value')),
    websiteClicks: metric(find('instagram', 'website_clicks', null, 'total_value')),
    netFollowerChange: netFollowsMetric(find('instagram', 'follows_and_unfollows', null, 'total_value')),
  } : null;
  return {
    platforms: { ...(facebook ? { facebook } : {}), ...(instagram ? { instagram } : {}) },
    combinedReachOrViewers: null,
    platformCount: [facebook, instagram].filter(Boolean).length,
  };
}
