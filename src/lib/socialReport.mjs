export function dateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

export function resolveSocialReportWindow(period, asOf, customStart = '', customEnd = '') {
  const end = new Date(asOf);
  const year = end.getUTCFullYear();
  const month = end.getUTCMonth();
  let start;
  let rangeEnd = end;
  let label = 'Last 30 days';

  if (period === 'this-month') {
    start = new Date(Date.UTC(year, month, 1));
    label = 'This month';
  } else if (period === 'previous-month') {
    start = new Date(Date.UTC(year, month - 1, 1));
    rangeEnd = new Date(Date.UTC(year, month, 1) - 1);
    label = 'Previous month';
  } else if (period === 'school-year') {
    const isOnOrAfterSchoolYearStart = month > 6 || (month === 6 && end.getUTCDate() >= 15);
    const startYear = isOnOrAfterSchoolYearStart ? year : year - 1;
    start = new Date(Date.UTC(startYear, 6, 15));
    label = `School year ${startYear}–${String(startYear + 1).slice(-2)}`;
  } else if (period === 'calendar-year') {
    start = new Date(Date.UTC(year, 0, 1));
    label = `Calendar year ${year}`;
  } else if (period === 'custom') {
    start = customStart ? new Date(`${customStart}T00:00:00.000Z`) : new Date(0);
    rangeEnd = customEnd ? new Date(`${customEnd}T23:59:59.999Z`) : end;
    label = customStart || customEnd ? `Custom ${customStart || 'beginning'} to ${customEnd || 'today'}` : 'Custom range';
  } else {
    start = new Date(end.getTime() - (30 * 24 * 60 * 60 * 1000));
  }

  return { start, end: rangeEnd, label, startInput: dateInputValue(start), endInput: dateInputValue(rangeEnd) };
}

export function resolveSocialReportComparisonWindow(period, asOf, customStart = '', customEnd = '') {
  const current = resolveSocialReportWindow(period, asOf, customStart, customEnd);
  const end = new Date(asOf);
  let start;
  let rangeEnd;
  let label = `Previous period before ${current.label.toLowerCase()}`;

  if (period === 'this-month') {
    const previousMonthStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
    const previousMonthLastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0)).getUTCDate();
    const comparisonDay = Math.min(end.getUTCDate(), previousMonthLastDay);
    rangeEnd = new Date(Date.UTC(
      previousMonthStart.getUTCFullYear(),
      previousMonthStart.getUTCMonth(),
      comparisonDay,
      end.getUTCHours(),
      end.getUTCMinutes(),
      end.getUTCSeconds(),
      end.getUTCMilliseconds(),
    ));
    const currentDuration = current.end.getTime() - current.start.getTime();
    start = rangeEnd.getTime() - previousMonthStart.getTime() < currentDuration
      ? new Date(rangeEnd.getTime() - currentDuration)
      : previousMonthStart;
    label = `Previous equal-length period through ${rangeEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  } else if (period === 'previous-month') {
    const selectedMonthStart = current.start;
    start = new Date(Date.UTC(selectedMonthStart.getUTCFullYear(), selectedMonthStart.getUTCMonth() - 1, 1));
    rangeEnd = new Date(Date.UTC(selectedMonthStart.getUTCFullYear(), selectedMonthStart.getUTCMonth(), 1) - 1);
    label = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  } else {
    const duration = current.end.getTime() - current.start.getTime();
    rangeEnd = new Date(current.start.getTime() - 1);
    start = new Date(rangeEnd.getTime() - duration);
  }

  return { start, end: rangeEnd, label, startInput: dateInputValue(start), endInput: dateInputValue(rangeEnd) };
}

export function calculateSocialMetricChange(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  const currentNumber = Number(current);
  const previousNumber = Number(previous);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(previousNumber)) return null;
  const absolute = currentNumber - previousNumber;
  return {
    absolute,
    percent: previousNumber === 0 ? null : (absolute / Math.abs(previousNumber)) * 100,
  };
}

const INTERACTION_METRICS = [
  ['reactions', 'reactionCount'],
  ['comments', 'commentCount'],
  ['comments', 'replyCount'],
  ['shares', 'shareCount'],
];

function finiteMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function reportTimestamp(result) {
  const timestamp = new Date(result?.date).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isEligibleSocialReportPost(result, window) {
  const timestamp = reportTimestamp(result);
  const start = window?.start instanceof Date ? window.start.getTime() : new Date(window?.start).getTime();
  const end = window?.end instanceof Date ? window.end.getTime() : new Date(window?.end).getTime();
  return result?.visibilityStatus === 'active'
    && result?.relationshipType === 'owned'
    && timestamp !== null
    && Number.isFinite(start)
    && Number.isFinite(end)
    && timestamp >= start
    && timestamp <= end;
}

export function metricAvailabilityCoverage(results, metric) {
  return {
    available: results.filter((result) => result?.metricAvailability?.[metric] === true).length,
    total: results.length,
  };
}

export function socialReportInteractionTotal(result) {
  const availableMetrics = INTERACTION_METRICS.filter(([metric]) => result?.metricAvailability?.[metric] === true);
  if (!availableMetrics.length) return null;
  return availableMetrics.reduce((sum, [, field]) => sum + finiteMetric(result?.[field]), 0);
}

export function socialReportMetricValue(result, metric) {
  if (result?.metricAvailability?.[metric] !== true) return null;
  if (metric === 'comments') return finiteMetric(result?.commentCount) + finiteMetric(result?.replyCount);
  const field = {
    reactions: 'reactionCount',
    shares: 'shareCount',
    views: 'viewCount',
  }[metric];
  return field ? finiteMetric(result?.[field]) : null;
}

export function neutralizeSpreadsheetFormula(value) {
  const text = String(value ?? '');
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function rankSocialReportTopPerformers(results, limit = 10) {
  const safeLimit = Math.max(0, Number(limit) || 0);
  return results.slice().sort((a, b) => {
    const interactionDifference = (socialReportInteractionTotal(b) ?? -1) - (socialReportInteractionTotal(a) ?? -1);
    if (interactionDifference) return interactionDifference;
    const dateDifference = (reportTimestamp(b) ?? -1) - (reportTimestamp(a) ?? -1);
    if (dateDifference) return dateDifference;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  }).slice(0, safeLimit);
}

export function selectOfficialSocialReportPosts(results, sources, districtId, window, limit = Number.POSITIVE_INFINITY) {
  const officialSourceKeys = new Set((sources || [])
    .filter((source) => source?.active === true
      && source?.district_id === districtId
      && Boolean(String(source?.handle || source?.profile_url || '').trim()))
    .map((source) => `${source.id}:${source.district_id}:${String(source.platform || '').toLowerCase()}`));

  const eligible = (results || []).filter((result) => result?.districtId === districtId
    && isEligibleSocialReportPost(result, window)
    && officialSourceKeys.has(`${result.socialAccountId}:${result.districtId}:${String(result.platform || '').toLowerCase()}`));

  return rankSocialReportTopPerformers(eligible, limit);
}

export function sortSocialReportDetails(results) {
  return results.slice().sort((a, b) => {
    const dateDifference = (reportTimestamp(b) ?? -1) - (reportTimestamp(a) ?? -1);
    if (dateDifference) return dateDifference;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

export function summarizeSocialReport(results) {
  const interactionTotals = results.map(socialReportInteractionTotal).filter((value) => value !== null);
  const totalInteractions = interactionTotals.length
    ? interactionTotals.reduce((sum, value) => sum + value, 0)
    : null;
  const platformCounts = new Map();
  for (const result of results) {
    if (!result?.platform) continue;
    platformCounts.set(result.platform, (platformCounts.get(result.platform) || 0) + 1);
  }
  const platformBreakdown = [...platformCounts.entries()]
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform));
  const reportedViews = results.reduce((sum, result) => (
    result?.metricAvailability?.views === true ? sum + finiteMetric(result.viewCount) : sum
  ), 0);

  return {
    officialPosts: results.length,
    totalInteractions,
    interactionsAvailable: interactionTotals.length,
    averageInteractions: interactionTotals.length ? totalInteractions / interactionTotals.length : null,
    reportedViews: metricAvailabilityCoverage(results, 'views').available ? reportedViews : null,
    viewsCoverage: metricAvailabilityCoverage(results, 'views'),
    reactionsCoverage: metricAvailabilityCoverage(results, 'reactions'),
    commentsCoverage: metricAvailabilityCoverage(results, 'comments'),
    sharesCoverage: metricAvailabilityCoverage(results, 'shares'),
    platformCount: platformBreakdown.length,
    platformBreakdown,
    topPlatform: platformBreakdown[0]?.platform || null,
  };
}

export function summarizeSocialContentFormats(results) {
  const order = ['Video / Reel', 'Image / Photo', 'Text / Link'];
  const groups = new Map(order.map((format) => [format, []]));
  for (const result of results || []) {
    const mediaType = String(result?.mediaType || result?.providerMetadata?.media_type || result?.providerMetadata?.post_type || '').toLowerCase();
    const format = mediaType.includes('video') || mediaType.includes('reel') || Number(result?.providerMetadata?.duration_seconds) > 0
      ? 'Video / Reel'
      : result?.mediaUrl
        ? 'Image / Photo'
        : 'Text / Link';
    groups.get(format).push(result);
  }
  return order.map((format) => {
    const posts = groups.get(format);
    const interactionTotals = posts.map(socialReportInteractionTotal).filter((value) => value !== null);
    return {
      format,
      posts: posts.length,
      totalInteractions: interactionTotals.length ? interactionTotals.reduce((sum, value) => sum + value, 0) : null,
      averageInteractions: interactionTotals.length
        ? interactionTotals.reduce((sum, value) => sum + value, 0) / interactionTotals.length
        : null,
      interactionsAvailable: interactionTotals.length,
    };
  }).filter((row) => row.posts > 0);
}

export function groupTopReportPostsByPlatform(results, limitPerPlatform = 3) {
  const preferredOrder = ['facebook', 'instagram'];
  const eligible = results.filter((result) => result.visibilityStatus === 'active' && result.relationshipType === 'owned');
  const platforms = [...new Set(eligible.map((result) => result.platform).filter(Boolean))].sort((a, b) => {
    const aIndex = preferredOrder.indexOf(a);
    const bIndex = preferredOrder.indexOf(b);
    if (aIndex >= 0 || bIndex >= 0) return (aIndex < 0 ? preferredOrder.length : aIndex) - (bIndex < 0 ? preferredOrder.length : bIndex);
    return a.localeCompare(b);
  });

  return platforms.map((platform) => ({
    platform,
    posts: rankSocialReportTopPerformers(
      eligible.filter((result) => result.platform === platform),
      limitPerPlatform,
    ),
  }));
}
