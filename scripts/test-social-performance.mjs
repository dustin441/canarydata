import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSocialExecutiveDecision,
  buildSocialPerformance,
  buildSocialPerformanceFromDailySeries,
  buildSocialDailySeries,
  classifySocialTrend,
} from '../src/lib/socialPerformance.mjs';

const currentWindow = { start: new Date('2026-07-08T00:00:00.000Z'), end: new Date('2026-07-10T23:59:59.999Z') };
const comparisonWindow = { start: new Date('2026-07-01T00:00:00.000Z'), end: new Date('2026-07-03T23:59:59.999Z') };
const base = {
  district_id: 'district-1', provider: 'meta', metric_scope: 'account', social_thread_id: null,
  availability: 'available', metric_variant: 'default', period: 'day', source_scope: 'unknown',
  provider_object_id: 'asset-1', observed_at: '2026-07-11T12:00:00.000Z',
  account_identity: { name: 'District account', handle: 'district', profileUrl: 'https://example.test/district', platform: 'facebook' },
};
let sequence = 0;
function row(platform, link, metric, day, value, extra = {}) {
  sequence += 1;
  return {
    ...base,
    id: `row-${String(sequence).padStart(3, '0')}`,
    platform,
    provider_account_link_id: link,
    provider_metric_name: metric,
    normalized_metric_name: metric,
    metric_value: value,
    effective_at: `${day}T12:00:00.000Z`,
    account_identity: { ...base.account_identity, name: `${platform} ${link}`, platform },
    ...(platform === 'instagram' ? { metric_variant: 'time_series' } : {}),
    ...extra,
  };
}
function days(platform, link, metric, dates, values, extra = {}) {
  return dates.map((date, index) => row(platform, link, metric, date, values[index], extra));
}
const previousDates = ['2026-07-01', '2026-07-02', '2026-07-03'];
const currentDates = ['2026-07-08', '2026-07-09', '2026-07-10'];
const history = [
  ...days('facebook', 'fb-1', 'views', previousDates, [100, 100, 100]),
  ...days('facebook', 'fb-1', 'views', currentDates, [110, 110, 110]),
  ...days('facebook', 'fb-1', 'engagements', previousDates, [20, 20, 20]),
  ...days('facebook', 'fb-1', 'engagements', currentDates, [16, 16, 16]),
  ...days('instagram', 'ig-1', 'reach', previousDates, [50, 50, 50]),
  ...days('instagram', 'ig-1', 'reach', currentDates, [50, 50, 50]),
  ...days('instagram', 'ig-1', 'total_interactions', previousDates, [10, 10, 10]),
  ...days('instagram', 'ig-1', 'total_interactions', currentDates, [12, 12, 12]),
  ...days('instagram', 'ig-1', 'follower_change', previousDates, [2, 2, 2]),
  ...days('instagram', 'ig-1', 'follower_change', currentDates, [3, 3, 3]),
  row('facebook', 'fb-1', 'views', '2026-07-10', 9999, { period: 'days_28', observed_at: '2026-07-12T00:00:00.000Z' }),
  row('facebook', 'fb-1', 'engagements', '2026-07-10', 9999, { period: 'week' }),
  row('instagram', 'ig-1', 'reach', '2026-07-10', 9999, { metric_variant: 'total_value' }),
  row('instagram', 'ig-1', 'total_interactions', '2026-07-10', 9999, { metric_variant: 'total_value' }),
];

const olderDuplicate = row('facebook', 'fb-1', 'views', '2026-07-10', 1, { id: 'duplicate-z', observed_at: '2026-07-10T13:00:00.000Z' });
const newerDuplicate = row('facebook', 'fb-1', 'views', '2026-07-10', 120, { id: 'duplicate-a', observed_at: '2026-07-13T13:00:00.000Z' });
const stableLosingDuplicate = row('facebook', 'fb-1', 'views', '2026-07-10', 777, { id: 'duplicate-z2', observed_at: newerDuplicate.observed_at });
const series = buildSocialDailySeries([...history, olderDuplicate, stableLosingDuplicate, newerDuplicate]);
const fbViewJuly10 = series.find((point) => point.accountKey === 'fb-1' && point.metric === 'views' && point.date === '2026-07-10');
assert.equal(fbViewJuly10.value, 120, 'same-day rows use latest observed_at, then stable ascending id');
assert.equal(series.some((point) => point.value === 9999), false, 'rolling and total_value rows never enter arbitrary-window daily trends');
for (const point of series) {
  assert.deepEqual(
    Object.keys(point).sort(),
    ['accountIdentity', 'accountKey', 'date', 'effectiveAt', 'metric', 'observedAt', 'period', 'platform', 'value'].sort(),
    'server daily series exposes only the sanitized client contract',
  );
  assert.equal(Object.hasOwn(point, 'district_id'), false);
  assert.equal(Object.hasOwn(point, 'provider_object_id'), false);
  assert.equal(Object.hasOwn(point, 'breakdown'), false);
}

const performance = buildSocialPerformance([...history, olderDuplicate, stableLosingDuplicate, newerDuplicate], { currentWindow, comparisonWindow });
const performanceFromSeries = buildSocialPerformanceFromDailySeries(series, { currentWindow, comparisonWindow });
assert.deepEqual(performanceFromSeries, performance, 'server-sanitized daily series produces the same dynamic-window decision as raw server rows');
assert.deepEqual(
  buildSocialPerformanceFromDailySeries(history, { currentWindow, comparisonWindow }).accounts,
  [],
  'the client-facing builder rejects raw snapshot rows instead of consuming provider fields',
);
const unsafePoint = { ...series[0], value: 'not-a-number', provider_object_id: 'must-not-pass' };
assert.equal(
  buildSocialPerformanceFromDailySeries([unsafePoint], { currentWindow, comparisonWindow }).accounts.length,
  0,
  'invalid values are safely excluded from sanitized daily series',
);
const broadWindowStartedAt = globalThis.performance.now();
const broadWindowPerformance = buildSocialPerformanceFromDailySeries(series, {
  currentWindow: { start: new Date('1900-01-01T00:00:00.000Z'), end: new Date('2099-12-31T23:59:59.999Z') },
  comparisonWindow: { start: new Date('1700-01-01T00:00:00.000Z'), end: new Date('1899-12-31T23:59:59.999Z') },
});
assert.equal(broadWindowPerformance.overallStatus, 'insufficient_history');
assert.ok(globalThis.performance.now() - broadWindowStartedAt < 250, 'large custom windows use constant-time date bounds rather than expanding every calendar date');
const performanceSource = readFileSync(new URL('../src/lib/socialPerformance.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(performanceSource, /for\s*\([^)]*DAY_MS/, 'window completeness must not expand calendar days in a loop');
assert.equal(performance.coverage.start, '2026-07-01');
assert.equal(performance.coverage.end, '2026-07-10');
assert.equal(performance.comparableCount, 5);
assert.equal(performance.overallStatus, 'mixed');
assert.match(performance.baselineExplanation, /exact report windows/i);
assert.match(performance.baselineExplanation, /at least 3 daily points/i);
const facebook = performance.accounts.find((account) => account.accountKey === 'fb-1');
const instagram = performance.accounts.find((account) => account.accountKey === 'ig-1');
assert.deepEqual(
  [facebook.dimensions.visibility.currentValue, facebook.dimensions.visibility.comparisonValue, facebook.dimensions.visibility.status],
  [340, 300, 'improving'],
  'Facebook visibility uses additive daily views and the newest same-day snapshot',
);
assert.equal(facebook.dimensions.visibility.currentPoints, 3, 'same-day duplicates count once toward daily coverage');
assert.equal(facebook.dimensions.engagement.status, 'declining');
assert.equal(facebook.dimensions.audience.status, 'insufficient_history', 'Facebook audience is unavailable rather than inferred');
assert.equal(instagram.dimensions.visibility.status, 'steady', 'Instagram visibility uses daily time-series reach');
assert.equal(instagram.dimensions.engagement.status, 'improving', 'Instagram engagement requires daily time-series interactions');
assert.equal(instagram.dimensions.audience.status, 'improving', 'Instagram audience uses follower_change time series');
assert.equal(performance.combinedAudience, null, 'audiences are never summed across platforms');
assert.equal(Object.hasOwn(performance, 'audienceTotal'), false);
for (const account of performance.accounts) {
  for (const trend of Object.values(account.dimensions)) {
    assert.equal(trend.source.provider, 'Meta');
    assert.equal(trend.source.platform, account.platform === 'facebook' ? 'Facebook' : 'Instagram');
    assert.equal(trend.source.scope, 'account');
    assert.equal(trend.source.cadence, 'daily');
    assert.equal(trend.source.aggregation, 'sum');
    assert.deepEqual(trend.source.current.window, { start: '2026-07-08', end: '2026-07-10' });
    assert.deepEqual(trend.source.comparison.window, { start: '2026-07-01', end: '2026-07-03' });
    assert.deepEqual(trend.source.current.coverage, trend.currentCoverage);
    assert.deepEqual(trend.source.comparison.coverage, trend.comparisonCoverage);
    if (trend.metric) {
      assert.deepEqual(trend.source.current.dates, currentDates);
      assert.deepEqual(trend.source.comparison.dates, previousDates);
    }
    assert.match(trend.sourceLabel, /^Meta · (Facebook|Instagram) · account-level daily /);
    assert.match(trend.sourceLabel, /sum · current window 2026-07-08–2026-07-10, coverage/);
    assert.match(trend.sourceLabel, /comparison window 2026-07-01–2026-07-03, coverage/);
    assert.doesNotMatch(trend.sourceLabel, /impressions/i);
  }
}

const noInstagramDailyEngagement = buildSocialPerformance(history.map((item) => item.platform === 'instagram' && item.normalized_metric_name === 'total_interactions'
  ? { ...item, metric_variant: 'total_value' }
  : item), { currentWindow, comparisonWindow });
assert.equal(noInstagramDailyEngagement.accounts.find((account) => account.accountKey === 'ig-1').dimensions.engagement.status, 'insufficient_history');

const sparse = buildSocialPerformance(days('facebook', 'sparse', 'views', ['2026-07-01', '2026-07-02', '2026-07-08', '2026-07-09'], [1, 1, 2, 2]), { currentWindow, comparisonWindow });
assert.equal(sparse.accounts[0].dimensions.visibility.status, 'insufficient_history');
assert.equal(sparse.overallStatus, 'insufficient_history');

const sevenDayCurrentWindow = { start: new Date('2026-07-08T00:00:00.000Z'), end: new Date('2026-07-14T23:59:59.999Z') };
const sevenDayComparisonWindow = { start: new Date('2026-07-01T00:00:00.000Z'), end: new Date('2026-07-07T23:59:59.999Z') };
const sparseSevenDay = buildSocialPerformance([
  ...days('facebook', 'seven-sparse', 'views', ['2026-07-01', '2026-07-04', '2026-07-07'], [10, 10, 10]),
  ...days('facebook', 'seven-sparse', 'views', ['2026-07-08', '2026-07-11', '2026-07-14'], [20, 20, 20]),
], { currentWindow: sevenDayCurrentWindow, comparisonWindow: sevenDayComparisonWindow });
assert.equal(sparseSevenDay.accounts[0].dimensions.visibility.currentPoints, 3);
assert.equal(sparseSevenDay.accounts[0].dimensions.visibility.comparisonPoints, 3);
assert.equal(sparseSevenDay.accounts[0].dimensions.visibility.status, 'insufficient_history', 'three rows cannot classify an incomplete seven-day window');
const completePreviousWeek = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07'];
const completeCurrentWeek = ['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14'];
const completeSevenDay = buildSocialPerformance([
  ...days('facebook', 'seven-complete', 'views', completePreviousWeek, Array(7).fill(10)),
  ...days('facebook', 'seven-complete', 'views', completeCurrentWeek, Array(7).fill(20)),
], { currentWindow: sevenDayCurrentWindow, comparisonWindow: sevenDayComparisonWindow });
assert.equal(completeSevenDay.accounts[0].dimensions.visibility.status, 'improving', 'complete selected calendar windows may classify');
assert.equal(completeSevenDay.accounts[0].dimensions.visibility.source.current.complete, true);
assert.equal(completeSevenDay.accounts[0].dimensions.visibility.source.comparison.complete, true);

assert.equal(classifySocialTrend(106, 100, 3, 3, true, true).status, 'improving');
assert.equal(classifySocialTrend(94, 100, 3, 3, true, true).status, 'declining');
assert.equal(classifySocialTrend(105, 100, 3, 3, true, true).status, 'steady', 'exactly +5% is steady');
assert.equal(classifySocialTrend(95, 100, 3, 3, true, true).status, 'steady', 'exactly -5% is steady');
assert.equal(classifySocialTrend(100, 0, 3, 3, true, true).status, 'insufficient_history', 'zero baselines do not invent a percentage');
assert.equal(classifySocialTrend(100, 100, 2, 3, true, true).status, 'insufficient_history');
assert.equal(classifySocialTrend(100, 100, 7, 7, false, true).status, 'insufficient_history', 'classification requires complete current coverage');

const improvingOverall = buildSocialPerformance([
  ...days('facebook', 'positive', 'views', previousDates, [10, 10, 10]),
  ...days('facebook', 'positive', 'views', currentDates, [20, 20, 20]),
  ...days('facebook', 'positive', 'engagements', previousDates, [5, 5, 5]),
  ...days('facebook', 'positive', 'engagements', currentDates, [6, 6, 6]),
], { currentWindow, comparisonWindow });
assert.equal(improvingOverall.overallStatus, 'improving');
const decliningOverall = buildSocialPerformance([
  ...days('facebook', 'negative', 'views', previousDates, [20, 20, 20]),
  ...days('facebook', 'negative', 'views', currentDates, [10, 10, 10]),
  ...days('facebook', 'negative', 'engagements', previousDates, [10, 10, 10]),
  ...days('facebook', 'negative', 'engagements', currentDates, [5, 5, 5]),
], { currentWindow, comparisonWindow });
assert.equal(decliningOverall.overallStatus, 'declining');
const steadyOverall = buildSocialPerformance([
  ...days('facebook', 'steady', 'views', [...previousDates, ...currentDates], [10, 10, 10, 10, 10, 10]),
  ...days('facebook', 'steady', 'engagements', [...previousDates, ...currentDates], [5, 5, 5, 5, 5, 5]),
], { currentWindow, comparisonWindow });
assert.equal(steadyOverall.overallStatus, 'steady');

const executive = buildSocialExecutiveDecision(performance, { currentPostCount: 12, comparisonPostCount: 8 });
assert.equal(executive.overallLabel, 'Mixed');
assert.deepEqual(executive.dimensions.map((dimension) => dimension.label), ['Visibility', 'Engagement', 'Audience', 'Publishing output']);
assert.deepEqual(executive.dimensions.map((dimension) => dimension.status), ['improving', 'mixed', 'improving', 'increased']);
assert.equal(executive.dimensions.find((dimension) => dimension.label === 'Visibility').signals.length, 2, 'platform visibility signals remain separate rows');
assert.deepEqual(
  executive.dimensions.find((dimension) => dimension.label === 'Visibility').signals.map((signal) => [signal.platform, signal.metricLabel, signal.currentValue]),
  [['facebook', 'Views', 340], ['instagram', 'Reach', 150]],
  'Facebook views and Instagram reach are preserved rather than summed',
);
assert.equal(executive.dimensions.find((dimension) => dimension.label === 'Publishing output').signals[0].metricLabel, 'Published posts');
assert.equal(executive.dimensions.find((dimension) => dimension.label === 'Publishing output').statusLabel, 'Increased');
assert.doesNotMatch(JSON.stringify(executive), /impressions|combinedAudience|audienceTotal/i, 'the executive contract has no impression or combined-audience field');
assert.doesNotMatch(executive.summary, /because|caused|drove|due to|resulted/i, 'the deterministic summary makes no causal claim');
assert.match(executive.summary, /direction is mixed across 5 comparable native signals/i);
assert.match(executive.historyNote, /Selected native window: 2026-07-08 to 2026-07-10/);
assert.match(executive.historyNote, /Prior comparison window: 2026-07-01 to 2026-07-03/);

const rollupFixture = buildSocialExecutiveDecision({
  overallStatus: 'steady',
  comparableCount: 3,
  accounts: [
    { platform: 'facebook', dimensions: {
      visibility: { label: 'Views', status: 'steady' },
      engagement: { label: 'Engagement', status: 'declining' },
      audience: { label: 'Audience change', status: 'insufficient_history' },
    } },
    { platform: 'instagram', dimensions: {
      visibility: { label: 'Reach', status: 'steady' },
      engagement: { label: 'Engagement', status: 'insufficient_history' },
      audience: { label: 'Audience change', status: 'insufficient_history' },
    } },
  ],
});
assert.deepEqual(rollupFixture.dimensions.slice(0, 3).map((dimension) => dimension.status), ['steady', 'declining', 'insufficient_history'], 'dimension rollups cover all-steady, declining-only, and no-comparable cases');

for (const [status, label] of [
  ['improving', 'Improving'],
  ['declining', 'Declining'],
  ['mixed', 'Mixed'],
  ['steady', 'Steady'],
  ['insufficient_history', 'Building baseline'],
]) {
  assert.equal(buildSocialExecutiveDecision({ overallStatus: status, comparableCount: 2, accounts: [], coverage: { start: '2026-07-01', end: '2026-07-10' } }).overallLabel, label);
}

const baselineWithMorePosts = buildSocialExecutiveDecision(
  { overallStatus: 'insufficient_history', comparableCount: 0, accounts: [], coverage: { start: '2026-07-08', end: '2026-07-10' } },
  { currentPostCount: 50, comparisonPostCount: 1 },
);
assert.equal(baselineWithMorePosts.overallLabel, 'Building baseline', 'publishing volume cannot promote an unavailable native baseline into growth');
assert.equal(baselineWithMorePosts.dimensions.at(-1).status, 'increased');
assert.match(baselineWithMorePosts.historyNote, /Selected native window: not available/);
assert.match(baselineWithMorePosts.historyNote, /Prior comparison window: not available/);
assert.match(baselineWithMorePosts.historyNote, /Observed native history: 2026-07-08 to 2026-07-10/);
assert.match(baselineWithMorePosts.historyNote, /Two complete like-for-like windows are required/);

const noPriorPublishing = buildSocialExecutiveDecision({}, { currentPostCount: 5, comparisonPostCount: 0 }).dimensions.at(-1);
assert.equal(noPriorPublishing.status, 'no_prior_baseline');
assert.equal(noPriorPublishing.statusLabel, 'No prior baseline');
assert.equal(buildSocialExecutiveDecision({}, { currentPostCount: 4, comparisonPostCount: 5 }).dimensions.at(-1).status, 'decreased');
assert.equal(buildSocialExecutiveDecision({}, { currentPostCount: 5, comparisonPostCount: 5 }).dimensions.at(-1).status, 'steady');

const dataSource = readFileSync(new URL('../src/lib/data.js', import.meta.url), 'utf8');
assert.match(dataSource, /const SOCIAL_METRIC_HISTORY_DAYS = 95;/, 'history reads cover exactly 95 complete UTC days');
const historyLoader = dataSource.slice(dataSource.indexOf('export async function getSocialMetricHistory'), dataSource.indexOf('export async function readAllSocialReviewEvents'));
assert.match(historyLoader, /if \(!districtId \|\| districtId === 'All'\) return \[\]/);
assert.ok(historyLoader.indexOf("if (!districtId || districtId === 'All') return [];") < historyLoader.indexOf('createAdminClient()'), 'missing and All district scopes return before creating a service-role client');
assert.match(historyLoader, /\.from\('social_provider_metric_snapshots'\)/);
assert.match(historyLoader, /\.eq\('district_id', districtId\)/);
assert.match(historyLoader, /\.eq\('metric_scope', 'account'\)/);
assert.match(historyLoader, /\.gte\('effective_at', historyStart\.toISOString\(\)\)/);
assert.match(historyLoader, /\.lt\('effective_at', historyEnd\.toISOString\(\)\)/);
assert.match(historyLoader, /\.eq\('provider', 'meta'\)[\s\S]*?\.eq\('active', true\)/);
assert.match(historyLoader, /\.from\('social_provider_account_links'\)[\s\S]*?\.eq\('district_id', districtId\)/, 'active link discovery is district constrained');
assert.match(historyLoader, /\.from\('social_provider_metric_snapshots'\)[\s\S]*?\.eq\('district_id', districtId\)[\s\S]*?\.eq\('metric_scope', 'account'\)[\s\S]*?\.in\('provider_account_link_id', linkBatch\)/, 'raw history is district, account, and active-link constrained');
assert.match(historyLoader, /loadEligibleSocialMetricLinkScope\(supabase, activeLinks, districtId\)/, 'history scope must come from the active selected asset lookup');
assert.match(historyLoader, /if \(!eligibleLinkIds\.length\) return \[\]/, 'history reads stop when no eligible backing assets exist');
assert.match(historyLoader, /eligibleLinkIds\.slice\(linkOffset, linkOffset \+ SOCIAL_METRIC_LINK_BATCH_SIZE\)/, 'history snapshot batches contain only eligible link ids');
assert.doesNotMatch(historyLoader, /activeLinkIds/, 'rejected active links must never become the history query scope');
assert.match(historyLoader, /\.order\('effective_at', \{ ascending: true \}\)[\s\S]*\.order\('observed_at', \{ ascending: true \}\)[\s\S]*\.order\('id', \{ ascending: true \}\)/);
assert.match(historyLoader, /\.range\(from, from \+ SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE - 1\)/);
assert.doesNotMatch(historyLoader, /provider_metadata/);

const dashboardPageSource = readFileSync(new URL('../src/app/dashboard/page.js', import.meta.url), 'utf8');
assert.match(dashboardPageSource, /getSocialMetricHistory/);
assert.match(dashboardPageSource, /buildSocialDailySeries/);
assert.match(dashboardPageSource, /dataDistrictId\s*\?\s*loadDashboardDataset\('Native Social history',\s*\(\)\s*=>\s*getSocialMetricHistory\(dataDistrictId\),\s*\[\]\)/, 'history is loaded only for one concrete data district and remains bounded by the loader');
assert.match(dashboardPageSource, /const socialPerformanceHistory = dataDistrictId[\s\S]*?\{ \[dataDistrictId\]: buildSocialDailySeries\(socialMetricHistory\.filter\(\(row\) => row\.district_id === dataDistrictId\)\) \}[\s\S]*?: \{\};/, 'raw history is district-filtered, transformed server-side, and keyed only by the selected data district');
assert.match(dashboardPageSource, /socialPerformanceHistory=\{socialPerformanceHistory\}/);
assert.doesNotMatch(dashboardPageSource, /socialMetricHistory=\{/i, 'raw history must never be passed to DashboardClient');

const dashboardClientSource = readFileSync(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
assert.match(dashboardClientSource, /import \{ buildSocialExecutiveDecision, buildSocialPerformanceFromDailySeries \} from '@\/lib\/socialPerformance\.mjs';/, 'the client imports only sanitized-series performance presentation builders');
assert.doesNotMatch(dashboardClientSource, /getSocialMetricHistory|buildSocialDailySeries|social_provider_metric_snapshots/, 'the client cannot load or sanitize raw history');
assert.match(dashboardClientSource, /socialPerformanceHistory = \{\}/, 'DashboardClient defaults missing history to an empty tenant map');
assert.match(dashboardClientSource, /socialPerformanceHistory=\{socialPerformanceHistory\}/, 'DashboardClient passes sanitized history through to SocialView');
assert.match(dashboardClientSource, /districtFilter === 'All'\s*\? \[\]\s*:\s*socialPerformanceHistory\[districtFilter\] \|\| \[\]/, 'All never selects a district series');
assert.match(dashboardClientSource, /useMemo\(\s*\(\) => buildSocialPerformanceFromDailySeries\(nativePerformanceSeries, \{\s*currentWindow: topPostsWindow,\s*comparisonWindow: comparisonPostsWindow,\s*\}\),\s*\[nativePerformanceSeries, topPostsWindow, comparisonPostsWindow\]/, 'native performance updates whenever sanitized history or either dynamic report window changes');
assert.match(dashboardClientSource, /performanceDecision=\{socialExecutiveDecision\}/, 'the deterministic executive decision reaches both screen and report views');
assert.match(dashboardClientSource, /buildSocialExecutiveDecision\(nativePerformance, \{\s*currentPostCount: socialReportPosts\.length,\s*comparisonPostCount: previousSocialReportPosts\.length/);

const srcRoot = new URL('../src/', import.meta.url);
const sourceFiles = readdirSync(srcRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name))
  .map((entry) => join(entry.parentPath, entry.name));
for (const sourceFile of sourceFiles) {
  const source = readFileSync(sourceFile, 'utf8');
  if (!sourceFile.endsWith('/src/lib/data.js')
    && !sourceFile.endsWith('/src/lib/meta-sync-service.mjs')
    && !sourceFile.endsWith('/src/app/dashboard/page.js')) {
    assert.doesNotMatch(source, /getSocialMetricHistory|social_provider_metric_snapshots/, `raw Social history must remain isolated to the server loader, server-side native sync, and dashboard page: ${sourceFile}`);
  }
  if (!/^\s*['\"]use client['\"];?/m.test(source)) continue;
  assert.doesNotMatch(source, /getSocialMetricHistory|social_provider_metric_snapshots/, `client file ${sourceFile} must not import or use raw Social history`);
  if (/socialPerformance\.mjs/.test(source)) {
    assert.equal(sourceFile.endsWith('/src/app/dashboard/DashboardClient.js'), true, `only DashboardClient may consume the sanitized Social performance module: ${sourceFile}`);
  }
}

console.log('Social native performance tests passed.');
