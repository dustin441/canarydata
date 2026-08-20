const DAY_MS = 86_400_000;
const MINIMUM_POINTS = 3;
const CHANGE_THRESHOLD_PERCENT = 5;

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function utcDay(value) {
  const parsed = timestamp(value);
  return parsed === null ? null : new Date(parsed).toISOString().slice(0, 10);
}

function finiteValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function isEligibleDailyRow(row) {
  if (row?.metric_scope !== 'account' || row?.availability !== 'available') return false;
  if (!row?.provider_account_link_id || finiteValue(row?.metric_value) === null || !utcDay(row?.effective_at)) return false;
  const platform = normalized(row.platform);
  const period = normalized(row.period);
  const variant = normalized(row.metric_variant || 'default');
  if (period !== 'day') return false;
  if (platform === 'facebook') return variant === 'default';
  if (platform === 'instagram') return variant === 'time_series';
  return false;
}

function dailyIdentity(row) {
  return [
    row.provider_account_link_id,
    normalized(row.platform),
    normalized(row.normalized_metric_name),
    normalized(row.period),
    utcDay(row.effective_at),
  ].join(':');
}

function rowWins(candidate, current) {
  const candidateObserved = timestamp(candidate.observed_at) ?? -1;
  const currentObserved = timestamp(current.observed_at) ?? -1;
  if (candidateObserved !== currentObserved) return candidateObserved > currentObserved;
  return String(candidate.id || '').localeCompare(String(current.id || '')) < 0;
}

function sanitizedIdentity(row) {
  const identity = row?.account_identity && typeof row.account_identity === 'object' ? row.account_identity : {};
  return {
    name: identity.name || null,
    handle: identity.handle || null,
    profileUrl: identity.profileUrl || null,
  };
}

function validatedDailySeriesPoint(point) {
  if (!point || typeof point !== 'object' || Array.isArray(point)) return null;
  if (typeof point.accountKey !== 'string' || !point.accountKey.trim()) return null;
  if (point.platform !== normalized(point.platform) || !['facebook', 'instagram'].includes(point.platform)) return null;
  if (typeof point.metric !== 'string' || !point.metric || point.metric !== normalized(point.metric)) return null;
  if (point.period !== 'day' || typeof point.date !== 'string' || utcDay(point.date) !== point.date) return null;
  if (typeof point.value !== 'number' || !Number.isFinite(point.value)) return null;
  if (!point.accountIdentity || typeof point.accountIdentity !== 'object' || Array.isArray(point.accountIdentity)) return null;
  const identity = point.accountIdentity;
  if (![identity.name, identity.handle, identity.profileUrl]
    .every((value) => value === null || typeof value === 'string')) return null;
  return {
    accountKey: point.accountKey,
    accountIdentity: {
      name: identity.name || null,
      handle: identity.handle || null,
      profileUrl: identity.profileUrl || null,
    },
    platform: point.platform,
    metric: point.metric,
    period: 'day',
    date: point.date,
    value: point.value,
  };
}

export function buildSocialDailySeries(rows = []) {
  const byDay = new Map();
  for (const row of rows || []) {
    if (!isEligibleDailyRow(row)) continue;
    const key = dailyIdentity(row);
    const current = byDay.get(key);
    if (!current || rowWins(row, current)) byDay.set(key, row);
  }
  return [...byDay.values()].map((row) => ({
    accountKey: String(row.provider_account_link_id),
    accountIdentity: sanitizedIdentity(row),
    platform: normalized(row.platform),
    metric: normalized(row.normalized_metric_name),
    period: 'day',
    date: utcDay(row.effective_at),
    effectiveAt: row.effective_at,
    observedAt: row.observed_at,
    value: finiteValue(row.metric_value),
  })).sort((a, b) => a.accountKey.localeCompare(b.accountKey)
    || a.platform.localeCompare(b.platform)
    || a.metric.localeCompare(b.metric)
    || a.period.localeCompare(b.period)
    || a.date.localeCompare(b.date));
}

function windowDescriptor(window) {
  const start = utcDay(window?.start);
  const end = utcDay(window?.end);
  if (!start || !end || start > end) return { start, end, expectedDays: 0 };
  const startAt = timestamp(`${start}T00:00:00.000Z`);
  const endAt = timestamp(`${end}T00:00:00.000Z`);
  return { start, end, expectedDays: Math.floor((endAt - startAt) / DAY_MS) + 1 };
}

function coverage(points) {
  if (!points.length) return { start: null, end: null };
  const dates = points.map((point) => point.date).sort();
  return { start: dates[0], end: dates.at(-1) };
}

function windowSummary(points, selected) {
  const observedDates = new Set(points.map((point) => point.date));
  return {
    window: { start: selected.start, end: selected.end },
    coverage: coverage(points),
    dates: [...observedDates].sort(),
    expectedDays: selected.expectedDays,
    observedDays: observedDates.size,
    complete: selected.expectedDays >= MINIMUM_POINTS && observedDates.size === selected.expectedDays,
  };
}

function sourceMetadata(platform, metric, label, currentSummary, comparisonSummary) {
  const platformLabel = platform === 'facebook' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : 'Unknown platform';
  const metricLabel = metric || `${normalized(label).replaceAll(' ', '_')}_unavailable`;
  const source = {
    provider: 'Meta',
    platform: platformLabel,
    scope: 'account',
    cadence: 'daily',
    metric: metric || null,
    metricLabel,
    aggregation: 'sum',
    current: currentSummary,
    comparison: comparisonSummary,
  };
  const coverageLabel = (summary) => summary.dates.length
    ? summary.dates.join(',')
    : 'none';
  const windowLabel = (summary) => summary.window.start && summary.window.end
    ? `${summary.window.start}–${summary.window.end}`
    : 'invalid';
  return {
    source,
    sourceLabel: `Meta · ${platformLabel} · account-level daily ${metricLabel} · sum · current window ${windowLabel(currentSummary)}, coverage ${coverageLabel(currentSummary)}; comparison window ${windowLabel(comparisonSummary)}, coverage ${coverageLabel(comparisonSummary)}`,
  };
}

function emptyTrend(metric, label, platform, currentWindow, comparisonWindow) {
  const currentSummary = windowSummary([], windowDescriptor(currentWindow));
  const comparisonSummary = windowSummary([], windowDescriptor(comparisonWindow));
  return {
    metric,
    label,
    aggregation: 'sum',
    currentValue: null,
    comparisonValue: null,
    absoluteChange: null,
    percentChange: null,
    currentPoints: 0,
    comparisonPoints: 0,
    currentCoverage: { start: null, end: null },
    comparisonCoverage: { start: null, end: null },
    status: 'insufficient_history',
    ...sourceMetadata(platform, metric, label, currentSummary, comparisonSummary),
  };
}

export function classifySocialTrend(currentValue, comparisonValue, currentPoints, comparisonPoints, currentComplete = false, comparisonComplete = false) {
  const current = finiteValue(currentValue);
  const comparison = finiteValue(comparisonValue);
  if (!currentComplete || !comparisonComplete || currentPoints < MINIMUM_POINTS || comparisonPoints < MINIMUM_POINTS || current === null || comparison === null || comparison === 0) {
    return { absoluteChange: null, percentChange: null, status: 'insufficient_history' };
  }
  const absoluteChange = current - comparison;
  const percentChange = (absoluteChange / Math.abs(comparison)) * 100;
  const status = percentChange > CHANGE_THRESHOLD_PERCENT
    ? 'improving'
    : percentChange < -CHANGE_THRESHOLD_PERCENT
      ? 'declining'
      : 'steady';
  return { absoluteChange, percentChange, status };
}

function inWindow(point, selected) {
  return selected.start !== null && selected.end !== null && point.date >= selected.start && point.date <= selected.end;
}

function trendFor(points, metric, label, platform, currentWindow, comparisonWindow) {
  if (!metric) return emptyTrend(null, label, platform, currentWindow, comparisonWindow);
  const metricPoints = points.filter((point) => point.metric === metric);
  const currentDescriptor = windowDescriptor(currentWindow);
  const comparisonDescriptor = windowDescriptor(comparisonWindow);
  const current = metricPoints.filter((point) => inWindow(point, currentDescriptor));
  const comparison = metricPoints.filter((point) => inWindow(point, comparisonDescriptor));
  const currentValue = current.length ? current.reduce((sum, point) => sum + point.value, 0) : null;
  const comparisonValue = comparison.length ? comparison.reduce((sum, point) => sum + point.value, 0) : null;
  const currentSummary = windowSummary(current, currentDescriptor);
  const comparisonSummary = windowSummary(comparison, comparisonDescriptor);
  return {
    metric,
    label,
    aggregation: 'sum',
    currentValue,
    comparisonValue,
    currentPoints: current.length,
    comparisonPoints: comparison.length,
    currentCoverage: currentSummary.coverage,
    comparisonCoverage: comparisonSummary.coverage,
    ...classifySocialTrend(currentValue, comparisonValue, current.length, comparison.length, currentSummary.complete, comparisonSummary.complete),
    ...sourceMetadata(platform, metric, label, currentSummary, comparisonSummary),
  };
}

function dimensionMetrics(platform, availableMetrics) {
  if (platform === 'facebook') {
    return { visibility: 'views', engagement: 'engagements', audience: null };
  }
  if (platform === 'instagram') {
    return {
      visibility: 'reach',
      engagement: availableMetrics.has('total_interactions') ? 'total_interactions' : (availableMetrics.has('engagements') ? 'engagements' : null),
      audience: 'follower_change',
    };
  }
  return { visibility: null, engagement: null, audience: null };
}

function overallStatus(statuses) {
  if (statuses.length < 2) return 'insufficient_history';
  const positive = statuses.includes('improving');
  const negative = statuses.includes('declining');
  if (positive && negative) return 'mixed';
  if (positive) return 'improving';
  if (negative) return 'declining';
  return 'steady';
}

const EXECUTIVE_STATUS_LABELS = Object.freeze({
  improving: 'Improving',
  declining: 'Declining',
  mixed: 'Mixed',
  steady: 'Steady',
  insufficient_history: 'Building baseline',
});

function executiveStatusLabel(status) {
  return EXECUTIVE_STATUS_LABELS[status] || EXECUTIVE_STATUS_LABELS.insufficient_history;
}

function rollupDimensionStatus(signals) {
  const statuses = signals
    .map((signal) => signal.status)
    .filter((status) => status && status !== 'insufficient_history');
  if (!statuses.length) return 'insufficient_history';
  if (statuses.includes('improving') && statuses.includes('declining')) return 'mixed';
  if (statuses.includes('improving')) return 'improving';
  if (statuses.includes('declining')) return 'declining';
  return 'steady';
}

function executiveSignal(account, dimensionKey) {
  const trend = account?.dimensions?.[dimensionKey];
  if (!trend) return null;
  return {
    platform: account.platform,
    accountIdentity: account.accountIdentity || { name: null, handle: null, profileUrl: null },
    metricLabel: trend.label,
    current: trend.currentValue,
    comparison: trend.comparisonValue,
    percent: trend.percentChange,
    currentValue: trend.currentValue,
    comparisonValue: trend.comparisonValue,
    percentChange: trend.percentChange,
    status: trend.status || 'insufficient_history',
    statusLabel: executiveStatusLabel(trend.status),
    source: trend.source || null,
    sourceLabel: trend.sourceLabel || '',
    currentCoverage: trend.currentCoverage || { start: null, end: null },
    comparisonCoverage: trend.comparisonCoverage || { start: null, end: null },
  };
}

function nativeDimension(accounts, id, label) {
  const signals = accounts.map((account) => executiveSignal(account, id)).filter(Boolean);
  const status = rollupDimensionStatus(signals);
  return { id, label, status, statusLabel: executiveStatusLabel(status), signals };
}

function publishingDimension(currentPostCount, comparisonPostCount) {
  const currentValue = Math.max(0, Number.isFinite(Number(currentPostCount)) ? Number(currentPostCount) : 0);
  const comparisonValue = Math.max(0, Number.isFinite(Number(comparisonPostCount)) ? Number(comparisonPostCount) : 0);
  const status = comparisonValue === 0
    ? 'no_prior_baseline'
    : currentValue > comparisonValue
      ? 'increased'
      : currentValue < comparisonValue
        ? 'decreased'
        : 'steady';
  const statusLabel = status === 'no_prior_baseline'
    ? 'No prior baseline'
    : status.charAt(0).toUpperCase() + status.slice(1);
  const percentChange = comparisonValue > 0 ? ((currentValue - comparisonValue) / comparisonValue) * 100 : null;
  return {
    id: 'publishing',
    label: 'Publishing output',
    status,
    statusLabel,
    signals: [{
      metricLabel: 'Published posts',
      current: currentValue,
      comparison: comparisonValue,
      percent: percentChange,
      currentValue,
      comparisonValue,
      percentChange,
      status,
      statusLabel,
      source: 'official_published_post_cohort',
    }],
  };
}

function coverageNote(nativePerformance, buildingBaseline) {
  const windowLabel = (window) => window?.start && window?.end
    ? `${window.start} to ${window.end}`
    : 'not available';
  const currentWindow = windowLabel(nativePerformance?.windows?.current);
  const comparisonWindow = windowLabel(nativePerformance?.windows?.comparison);
  const observedStart = nativePerformance?.coverage?.start;
  const observedEnd = nativePerformance?.coverage?.end;
  const observedCoverage = observedStart && observedEnd ? `${observedStart} to ${observedEnd}` : 'not available';
  if (buildingBaseline) {
    return `Selected native window: ${currentWindow}. Prior comparison window: ${comparisonWindow}. Observed native history: ${observedCoverage}. Two complete like-for-like windows are required before a performance direction is reported.`;
  }
  return `Selected native window: ${currentWindow}. Prior comparison window: ${comparisonWindow}. Observed native history: ${observedCoverage}. Direction uses Meta account-level daily signals; platform metrics remain separate.`;
}

/**
 * Creates the presentation-only executive decision contract. Native direction and
 * published-post output intentionally remain independent evidence cohorts.
 */
export function buildSocialExecutiveDecision(nativePerformance = {}, { currentPostCount = 0, comparisonPostCount = 0 } = {}) {
  const accounts = Array.isArray(nativePerformance?.accounts) ? nativePerformance.accounts : [];
  const nativeStatus = Object.hasOwn(EXECUTIVE_STATUS_LABELS, nativePerformance?.overallStatus)
    ? nativePerformance.overallStatus
    : 'insufficient_history';
  const comparableCount = Number.isFinite(Number(nativePerformance?.comparableCount))
    ? Math.max(0, Number(nativePerformance.comparableCount))
    : 0;
  const buildingBaseline = nativeStatus === 'insufficient_history';
  const direction = nativeStatus === 'mixed' ? 'mixed' : executiveStatusLabel(nativeStatus).toLowerCase();
  const summary = buildingBaseline
    ? 'Native account history is building; no performance direction is reported yet.'
    : `Native direction is ${direction} across ${comparableCount} comparable native ${comparableCount === 1 ? 'signal' : 'signals'} in the exact selected and prior windows.`;
  return {
    overallStatus: nativeStatus,
    overallLabel: executiveStatusLabel(nativeStatus),
    comparableCount,
    summary,
    historyNote: coverageNote(nativePerformance, buildingBaseline),
    dimensions: [
      nativeDimension(accounts, 'visibility', 'Visibility'),
      nativeDimension(accounts, 'engagement', 'Engagement'),
      nativeDimension(accounts, 'audience', 'Audience'),
      publishingDimension(currentPostCount, comparisonPostCount),
    ],
  };
}

export function buildSocialPerformanceFromDailySeries(series = [], { currentWindow, comparisonWindow } = {}) {
  const validatedSeries = (Array.isArray(series) ? series : [])
    .map(validatedDailySeriesPoint)
    .filter(Boolean);
  const grouped = new Map();
  for (const point of validatedSeries) {
    const key = `${point.accountKey}:${point.platform}`;
    const current = grouped.get(key) || [];
    current.push(point);
    grouped.set(key, current);
  }
  const accounts = [...grouped.values()].map((points) => {
    const platform = points[0].platform;
    const metrics = dimensionMetrics(platform, new Set(points.map((point) => point.metric)));
    return {
      accountKey: points[0].accountKey,
      platform,
      accountIdentity: points[0].accountIdentity,
      coverage: coverage(points),
      dimensions: {
        visibility: trendFor(points, metrics.visibility, platform === 'instagram' ? 'Reach' : 'Views', platform, currentWindow, comparisonWindow),
        engagement: trendFor(points, metrics.engagement, 'Engagement', platform, currentWindow, comparisonWindow),
        audience: trendFor(points, metrics.audience, 'Audience change', platform, currentWindow, comparisonWindow),
      },
    };
  }).sort((a, b) => a.platform.localeCompare(b.platform)
    || a.accountKey.localeCompare(b.accountKey));
  const comparableStatuses = accounts.flatMap((account) => Object.values(account.dimensions))
    .map((dimension) => dimension.status)
    .filter((status) => status !== 'insufficient_history');
  return {
    coverage: coverage(validatedSeries),
    windows: {
      current: { start: utcDay(currentWindow?.start), end: utcDay(currentWindow?.end) },
      comparison: { start: utcDay(comparisonWindow?.start), end: utcDay(comparisonWindow?.end) },
    },
    accounts,
    comparableCount: comparableStatuses.length,
    overallStatus: overallStatus(comparableStatuses),
    combinedAudience: null,
    baselineExplanation: 'Native daily account metrics compare additive sums across the exact report windows. Each metric requires complete daily coverage of both selected UTC calendar windows and at least 3 daily points in each; changes above +5% improve, below -5% decline, and values within ±5% are steady. Platform audiences remain separate.',
  };
}

export function buildSocialPerformance(rows = [], options = {}) {
  return buildSocialPerformanceFromDailySeries(buildSocialDailySeries(rows), options);
}

export const deriveNativeSocialPerformance = buildSocialPerformance;

export const SOCIAL_PERFORMANCE_POLICY = Object.freeze({
  minimumPointsPerWindow: MINIMUM_POINTS,
  changeThresholdPercent: CHANGE_THRESHOLD_PERCENT,
  historyDays: 95,
  dayMilliseconds: DAY_MS,
});
