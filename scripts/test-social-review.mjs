import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadBindings } from 'next/dist/build/swc/index.js';
import { normalizeSocialResult } from '../src/lib/social.mjs';
import {
  calculateSocialMetricChange,
  resolveSocialReportComparisonWindow,
  resolveSocialReportWindow,
  groupTopReportPostsByPlatform,
  isEligibleSocialReportPost,
  metricAvailabilityCoverage,
  neutralizeSpreadsheetFormula,
  rankSocialReportTopPerformers,
  selectOfficialSocialReportPosts,
  socialReportComparableInteractionTotal,
  socialReportInteractionTotal,
  socialReportMetricValue,
  sortSocialReportDetails,
  summarizeSocialContentFormats,
  summarizeSocialReport,
} from '../src/lib/socialReport.mjs';

assert.equal(neutralizeSpreadsheetFormula('=HYPERLINK("https://bad.example")'), "'=HYPERLINK(\"https://bad.example\")");
assert.equal(neutralizeSpreadsheetFormula('  @SUM(1,2)'), "'  @SUM(1,2)");
assert.equal(neutralizeSpreadsheetFormula('Normal post text'), 'Normal post text');
assert.equal(socialReportMetricValue({ commentCount: 5, replyCount: 7, metricAvailability: { comments: true } }, 'comments'), 12);
assert.equal(socialReportMetricValue({ shareCount: 0, metricAvailability: { shares: false } }, 'shares'), null);

const reviewed = normalizeSocialResult({
  id: 'thread-review-1',
  provider: 'apify',
  platform: 'facebook',
  social_account_id: '22222222-2222-2222-2222-222222222222',
  external_thread_id: 'official-1',
  relationship_type: 'owned',
  visibility_status: 'approved',
  reviewer_note: '**Safe official post.**',
  review_version: 4,
  reviewed_at: '2026-07-23T12:00:00Z',
  reviewed_by: '11111111-1111-1111-1111-111111111111',
});
assert.equal(reviewed.visibilityStatus, 'approved');
assert.equal(reviewed.reviewerNote, 'Safe official post.');
assert.equal(reviewed.reviewVersion, 4);
assert.equal(reviewed.reviewedAt, '2026-07-23T12:00:00Z');
assert.equal(reviewed.socialAccountId, '22222222-2222-2222-2222-222222222222');

const providerWithoutAvailability = normalizeSocialResult({
  id: 'no-metric-contract', provider: 'apify', platform: 'facebook',
  reaction_count: 0, comment_count: 0, share_count: 0, view_count: 0,
});
assert.deepEqual(providerWithoutAvailability.metricAvailability, {
  reactions: false, comments: false, shares: false, views: false,
});

const schoolYearAfterBoundary = resolveSocialReportWindow('school-year', Date.UTC(2026, 6, 24));
assert.equal(schoolYearAfterBoundary.startInput, '2026-07-15');
const schoolYearBeforeBoundary = resolveSocialReportWindow('school-year', Date.UTC(2026, 6, 14));
assert.equal(schoolYearBeforeBoundary.startInput, '2025-07-15');
const completedMonth = resolveSocialReportWindow('previous-month', Date.UTC(2026, 6, 24));
const completedMonthComparison = resolveSocialReportComparisonWindow('previous-month', Date.UTC(2026, 6, 24));
assert.deepEqual([completedMonth.startInput, completedMonth.endInput], ['2026-06-01', '2026-06-30']);
assert.deepEqual([completedMonthComparison.startInput, completedMonthComparison.endInput], ['2026-05-01', '2026-05-31']);
const monthToDateComparison = resolveSocialReportComparisonWindow('this-month', Date.UTC(2026, 6, 24, 18));
assert.deepEqual([monthToDateComparison.startInput, monthToDateComparison.endInput], ['2026-06-01', '2026-06-24']);
assert.equal(monthToDateComparison.start.toISOString(), '2026-06-01T00:00:00.000Z');
assert.equal(monthToDateComparison.end.toISOString(), '2026-06-24T18:00:00.000Z');
const shortPriorMonthComparison = resolveSocialReportComparisonWindow('this-month', Date.UTC(2026, 2, 31, 18));
assert.equal(shortPriorMonthComparison.end.toISOString(), '2026-02-28T18:00:00.000Z');
assert.equal(shortPriorMonthComparison.end.getTime() - shortPriorMonthComparison.start.getTime(), resolveSocialReportWindow('this-month', Date.UTC(2026, 2, 31, 18)).end.getTime() - resolveSocialReportWindow('this-month', Date.UTC(2026, 2, 31, 18)).start.getTime());
assert.deepEqual(calculateSocialMetricChange(12, 10), { absolute: 2, percent: 20 });
assert.deepEqual(calculateSocialMetricChange(3, 0), { absolute: 3, percent: null });
assert.equal(calculateSocialMetricChange(null, 10), null);

const reportWindow = {
  start: new Date('2026-07-01T00:00:00.000Z'),
  end: new Date('2026-07-31T23:59:59.999Z'),
};
const reportPosts = [
  {
    id: 'fb-high', platform: 'facebook', date: '2026-07-20T12:00:00Z', visibilityStatus: 'active', relationshipType: 'owned',
    reactionCount: 22, commentCount: 2, shareCount: 1, viewCount: 100,
    metricAvailability: { reactions: true, comments: true, shares: true, views: true },
  },
  {
    id: 'ig-tie-b', platform: 'instagram', date: '2026-07-21T12:00:00Z', visibilityStatus: 'active', relationshipType: 'owned',
    reactionCount: 8, commentCount: 4, shareCount: 1, viewCount: 0,
    metricAvailability: { reactions: true, comments: true, shares: true, views: false },
  },
  {
    id: 'ig-tie-a', platform: 'instagram', date: '2026-07-21T12:00:00Z', visibilityStatus: 'active', relationshipType: 'owned',
    reactionCount: 12, commentCount: 1, shareCount: 0, viewCount: 50,
    metricAvailability: { reactions: true, comments: true, shares: false, views: true },
  },
  {
    id: 'fb-no-metrics', platform: 'facebook', date: '2026-07-22T12:00:00Z', visibilityStatus: 'active', relationshipType: 'owned',
    reactionCount: 0, commentCount: 0, shareCount: 0, viewCount: 0,
    metricAvailability: { reactions: false, comments: false, shares: false, views: false },
  },
  { id: 'review', platform: 'facebook', date: '2026-07-23T12:00:00Z', visibilityStatus: 'review', relationshipType: 'owned', metricAvailability: {} },
  { id: 'mention', platform: 'facebook', date: '2026-07-23T12:00:00Z', visibilityStatus: 'active', relationshipType: 'direct', metricAvailability: {} },
  { id: 'outside', platform: 'facebook', date: '2026-06-30T23:59:59Z', visibilityStatus: 'active', relationshipType: 'owned', metricAvailability: {} },
];

assert.equal(isEligibleSocialReportPost(reportPosts[0], reportWindow), true);
assert.equal(isEligibleSocialReportPost(reportPosts[4], reportWindow), false);
assert.equal(isEligibleSocialReportPost(reportPosts[5], reportWindow), false);
assert.equal(isEligibleSocialReportPost(reportPosts[6], reportWindow), false);

const eligibleReportPosts = reportPosts.filter((post) => isEligibleSocialReportPost(post, reportWindow));
assert.deepEqual(metricAvailabilityCoverage(eligibleReportPosts, 'views'), { available: 2, total: 4 });
assert.deepEqual(metricAvailabilityCoverage(eligibleReportPosts, 'shares'), { available: 2, total: 4 });
assert.equal(socialReportInteractionTotal(eligibleReportPosts[2]), 13, 'reported interaction ranking may use available components without inventing missing values');
assert.equal(socialReportComparableInteractionTotal(eligibleReportPosts[2]), null, 'partial interaction components must not enter comparable totals');
assert.deepEqual(rankSocialReportTopPerformers(eligibleReportPosts, 3).map((post) => post.id), ['fb-high', 'ig-tie-a', 'ig-tie-b']);
assert.deepEqual(sortSocialReportDetails(eligibleReportPosts).map((post) => post.id), ['fb-no-metrics', 'ig-tie-a', 'ig-tie-b', 'fb-high']);

const platformTopPerformers = groupTopReportPostsByPlatform([
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `fb-${index}`,
    platform: 'facebook',
    date: `2026-07-${String(16 + index).padStart(2, '0')}T12:00:00Z`,
    visibilityStatus: 'active',
    relationshipType: 'owned',
    reactionCount: 100 - index, commentCount: 0, shareCount: 0,
    metricAvailability: { reactions: true, comments: true, shares: true },
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `ig-${index}`,
    platform: 'instagram',
    date: `2026-07-${String(16 + index).padStart(2, '0')}T12:00:00Z`,
    visibilityStatus: 'active',
    relationshipType: 'owned',
    reactionCount: 20 - index, commentCount: 0, shareCount: 0,
    metricAvailability: { reactions: true, comments: true, shares: true },
  })),
]);
assert.deepEqual(platformTopPerformers.map(({ platform, rankingBasis, posts }) => [platform, rankingBasis, posts.map((post) => post.id)]), [
  ['facebook', 'mixed-coverage', ['fb-0', 'fb-1', 'fb-2']],
  ['instagram', 'mixed-coverage', ['ig-0', 'ig-1', 'ig-2']],
]);
assert.deepEqual(groupTopReportPostsByPlatform([{
  id: 'partial-only-facebook',
  platform: 'facebook',
  date: '2026-07-20T12:00:00Z',
  visibilityStatus: 'active',
  relationshipType: 'owned',
  reactionCount: 10,
  commentCount: 2,
  shareCount: 0,
  metricAvailability: { reactions: true, comments: true, shares: false },
}]).map(({ platform, rankingBasis, posts }) => [platform, rankingBasis, posts.map((post) => post.id)]), [
  ['facebook', 'partial-only', ['partial-only-facebook']],
], 'partial-only providers still need a useful ranking with explicit coverage disclosure');

const reportSummary = summarizeSocialReport(eligibleReportPosts);
assert.equal(reportSummary.officialPosts, 4);
assert.equal(reportSummary.totalInteractions, 38);
assert.equal(reportSummary.interactionsAvailable, 2);
assert.equal(reportSummary.averageInteractions, 19);
assert.equal(reportSummary.reportedViews, 150);
assert.deepEqual(reportSummary.viewsCoverage, { available: 2, total: 4 });
assert.deepEqual(reportSummary.reactionsCoverage, { available: 3, total: 4 });
assert.deepEqual(reportSummary.commentsCoverage, { available: 3, total: 4 });
assert.deepEqual(reportSummary.sharesCoverage, { available: 2, total: 4 });
assert.deepEqual(reportSummary.platformBreakdown, [
  { platform: 'facebook', count: 2 },
  { platform: 'instagram', count: 2 },
]);
assert.equal(reportSummary.topPlatform, 'facebook');
assert.deepEqual(summarizeSocialContentFormats([
  { ...eligibleReportPosts[0], mediaType: 'video' },
  { ...eligibleReportPosts[1], mediaUrl: 'https://cdninstagram.com/a.jpg' },
  { ...eligibleReportPosts[2], id: 'mixed-case-reel', mediaType: 'Reel', mediaUrl: 'https://cdninstagram.com/reel.jpg' },
  { ...eligibleReportPosts[3], mediaType: null, mediaUrl: '' },
]).map(({ format, posts, totalInteractions }) => ({ format, posts, totalInteractions })), [
  { format: 'Video / Reel', posts: 2, totalInteractions: 25 },
  { format: 'Image / Photo', posts: 1, totalInteractions: 13 },
  { format: 'Text / Link', posts: 1, totalInteractions: null },
]);
const unavailableSummary = summarizeSocialReport([eligibleReportPosts.find((post) => post.id === 'fb-no-metrics')]);
assert.equal(unavailableSummary.totalInteractions, null);
assert.equal(unavailableSummary.averageInteractions, null);
assert.equal(unavailableSummary.reportedViews, null);

const officialSources = [
  { id: 'official-fb', district_id: 'district-a', platform: 'facebook', active: true, handle: 'districta' },
  { id: 'official-ig', district_id: 'district-a', platform: 'instagram', active: true, profile_url: 'https://instagram.com/districta' },
  { id: 'inactive-ig', district_id: 'district-a', platform: 'instagram', active: false, handle: 'districta' },
  { id: 'anonymous-ig', district_id: 'district-a', platform: 'instagram', active: true, handle: '', profile_url: '' },
];
const officialCandidates = [
  ...reportPosts.slice(0, 4).map((post) => ({ ...post, districtId: 'district-a', socialAccountId: post.platform === 'instagram' ? 'official-ig' : 'official-fb' })),
  { ...reportPosts[0], id: 'wrong-district', districtId: 'district-b', socialAccountId: 'official-fb' },
  { ...reportPosts[0], id: 'wrong-platform', platform: 'instagram', districtId: 'district-a', socialAccountId: 'official-fb' },
  { ...reportPosts[0], id: 'inactive-source', platform: 'instagram', districtId: 'district-a', socialAccountId: 'inactive-ig' },
  { ...reportPosts[0], id: 'anonymous-source', platform: 'instagram', districtId: 'district-a', socialAccountId: 'anonymous-ig' },
  { ...reportPosts[6], districtId: 'district-a', socialAccountId: 'official-fb' },
];
assert.deepEqual(
  selectOfficialSocialReportPosts(officialCandidates, officialSources, 'district-a', reportWindow, 3).map((post) => post.id),
  ['fb-high', 'ig-tie-a', 'ig-tie-b'],
);

const [sql, actions, dashboard, styles, data, melodi] = await Promise.all([
  readFile(new URL('../supabase/social_review_workflow.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/globals.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/data.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/melodi/route.js', import.meta.url), 'utf8'),
]);

async function compileDataModuleForPaginationTest(source, createAdminClient) {
  const bindings = await loadBindings();
  const compiled = await bindings.transform(source, {
    filename: 'data.js',
    jsc: {
      parser: { syntax: 'ecmascript' },
      target: 'es2022',
    },
    module: { type: 'commonjs' },
  });
  const moduleRecord = { exports: {} };
  const modules = {
    '@/lib/supabase/admin': { createAdminClient },
    '@/lib/collectionHealth.mjs': { buildCollectionHealth: () => ({}) },
    '@/lib/social-affiliate-preview': { buildSocialAffiliatePreview: () => ({}) },
  };
  const controlledRequire = (specifier) => {
    assert.ok(specifier in modules, `Unexpected module import in data harness: ${specifier}`);
    return modules[specifier];
  };
  const evaluate = new Function('require', 'module', 'exports', compiled.code);
  evaluate(controlledRequire, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function createSocialReviewEventsClient(rows, { errorFrom = null } = {}) {
  const calls = [];
  const client = {
    from(table) {
      const call = { table, selected: null, orders: [], ranges: [], predicates: [] };
      calls.push(call);
      const query = {
        select(columns) { call.selected = columns; return query; },
        order(column, options) { call.orders.push([column, options]); return query; },
        range(from, to) { call.ranges.push([from, to]); call.from = from; call.to = to; return query; },
        limit(limit) { call.from = 0; call.to = limit - 1; return query; },
        eq(column, value) { call.predicates.push([column, value]); return query; },
        then(resolve) {
          if (call.from === errorFrom) return resolve({ data: null, error: new Error(`page failed at ${errorFrom}`) });
          return resolve({ data: rows.slice(call.from, call.to + 1), error: null });
        },
      };
      return query;
    },
  };
  return { client, calls };
}

const auditRows = Array.from({ length: 1205 }, (_, index) => ({ id: `audit-${String(index).padStart(4, '0')}` }));
const auditHarness = createSocialReviewEventsClient(auditRows);
const dataModule = await compileDataModuleForPaginationTest(data, () => auditHarness.client);
const auditEvents = await dataModule.getSocialReviewEvents('district-a');
assert.equal(typeof dataModule.readAllSocialReviewEvents, 'function', 'Audit pagination must be separately exported and testable.');
assert.equal(auditEvents.length, 1205);
assert.equal(new Set(auditEvents.map((event) => event.id)).size, 1205);
assert.deepEqual(auditEvents.map((event) => event.id), auditRows.map((event) => event.id));
assert.deepEqual(auditHarness.calls.map((call) => call.ranges[0]), [[0, 999], [1000, 1999]]);
for (const call of auditHarness.calls) {
  assert.equal(call.table, 'social_review_events');
  assert.equal(call.selected, 'id, batch_id, district_id, social_thread_id, actor_user_id, action, before_state, after_state, resulting_version, created_at');
  assert.deepEqual(call.orders, [['created_at', { ascending: false }], ['id', { ascending: false }]]);
  assert.deepEqual(call.predicates, [['district_id', 'district-a']]);
}

const failingAuditHarness = createSocialReviewEventsClient(auditRows, { errorFrom: 1000 });
const failingDataModule = await compileDataModuleForPaginationTest(data, () => failingAuditHarness.client);
await assert.rejects(
  failingDataModule.getSocialReviewEvents('district-a'),
  /page failed at 1000/,
  'A later page error must reject instead of returning a partial audit history.',
);
assert.deepEqual(failingAuditHarness.calls.map((call) => call.ranges[0]), [[0, 999], [1000, 1999]]);

function createHookRenderer() {
  const componentState = new Map();
  let currentInstance = null;
  let hookCursor = 0;
  let pendingEffects = [];

  const sameDependencies = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const slot = () => {
    assert.ok(currentInstance, 'Hooks may only run while rendering a component.');
    const index = hookCursor++;
    const hooks = componentState.get(currentInstance);
    return { hooks, index };
  };
  const react = {
    useState(initialValue) {
      const { hooks, index } = slot();
      if (!(index in hooks)) hooks[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
      const setValue = (nextValue) => {
        hooks[index] = typeof nextValue === 'function' ? nextValue(hooks[index]) : nextValue;
      };
      return [hooks[index], setValue];
    },
    useMemo(factory) {
      const { hooks, index } = slot();
      hooks[index] = factory();
      return hooks[index];
    },
    useEffect(effect, dependencies) {
      const { hooks, index } = slot();
      const previous = hooks[index];
      if (!previous || !sameDependencies(previous.dependencies, dependencies)) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          hooks[index] = { dependencies, cleanup: effect() };
        });
      }
    },
    useRef(initialValue) {
      const { hooks, index } = slot();
      if (!(index in hooks)) hooks[index] = { current: initialValue };
      return hooks[index];
    },
    useTransition() {
      slot();
      return [false, (callback) => callback()];
    },
    useCallback(callback) {
      slot();
      return callback;
    },
  };
  const Fragment = Symbol('Fragment');
  const jsx = (type, props = {}, key = null) => ({ type, props, key });

  function renderNode(node, path = '0') {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${path}.${index}`)).flat().filter((child) => child !== null);
    if (node.type === Fragment) return renderNode(node.props.children, `${path}.f`);
    if (typeof node.type === 'function') {
      const previousInstance = currentInstance;
      const previousCursor = hookCursor;
      const identity = `${path}:${node.type.name || 'anonymous'}:${node.key ?? ''}`;
      if (!componentState.has(identity)) componentState.set(identity, []);
      currentInstance = identity;
      hookCursor = 0;
      const rendered = node.type(node.props);
      currentInstance = previousInstance;
      hookCursor = previousCursor;
      return renderNode(rendered, `${path}.c`);
    }
    const children = renderNode(node.props?.children, `${path}.h`);
    return { type: node.type, props: { ...node.props, children }, key: node.key };
  }

  function render(Component, props) {
    pendingEffects = [];
    const tree = renderNode(jsx(Component, props));
    const effects = pendingEffects;
    pendingEffects = [];
    effects.forEach((effect) => effect());
    return tree;
  }

  return { react, jsxRuntime: { Fragment, jsx, jsxs: jsx }, render };
}

function nodeText(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(nodeText).join('');
  return nodeText(node.props?.children);
}

function findNodes(node, predicate, matches = []) {
  if (node === null || node === undefined || typeof node === 'string') return matches;
  if (Array.isArray(node)) {
    node.forEach((child) => findNodes(child, predicate, matches));
    return matches;
  }
  if (predicate(node)) matches.push(node);
  findNodes(node.props?.children, predicate, matches);
  return matches;
}

function findButton(tree, label) {
  const button = findNodes(tree, (node) => node.type === 'button' && nodeText(node).includes(label))[0];
  assert.ok(button, `Expected a ${label} button.`);
  return button;
}

async function compileSocialViewForInteractionTest(source, reviewSocialThreadMock) {
  const [socialModule, socialReportModule, dateModule] = await Promise.all([
    import('../src/lib/social.mjs'),
    import('../src/lib/socialReport.mjs'),
    import('../src/lib/date.mjs'),
  ]);
  const renderer = createHookRenderer();
  const hostComponent = ({ children, ...props }) => renderer.jsxRuntime.jsx('stub', { ...props, children });
  const actionModule = {
    setEarnedMedia() {}, saveNote() {}, addQuery() {}, updateQuery() {}, deleteQuery() {}, submitFeedback() {},
    addManualStory() {}, excludeStory() {}, restoreStory() {}, reviewSocialThread: reviewSocialThreadMock,
  };
  const modules = {
    react: renderer.react,
    'react/jsx-runtime': renderer.jsxRuntime,
    'next/image': { __esModule: true, default: hostComponent },
    'next/link': { __esModule: true, default: hostComponent },
    '@stripe/stripe-js': { loadStripe: () => null },
    '@/app/actions': actionModule,
    '@/app/payment/actions': { createEmbeddedCanaryCheckout() {}, confirmEmbeddedCanaryCheckout() {}, saveBillingPurchaseOrder() {} },
    '@/lib/strategicAlignmentSort.mjs': { compareStrategicAlignmentRows: () => 0 },
    '@/lib/canonicalTags.mjs': { CORE_TAGS: [], canonicalTags: () => [] },
    '@/lib/social.mjs': socialModule,
    '@/lib/socialReport.mjs': socialReportModule,
    '@/lib/socialMetrics.mjs': { enrichSocialThreadsWithNativeMetrics: (threads) => threads, summarizeOwnedSocialAccountMetrics: () => ({ platforms: {}, platformCount: 0, combinedReachOrViewers: null }) },
    '@/lib/date.mjs': dateModule,
    '@/lib/queryPolicy.mjs': { CUSTOMER_SEARCH_QUERY_LIMIT: 10, activeNewsQueryCount: () => 0 },
    '@/lib/communicationsBrief.mjs': { buildCommunicationsBrief: () => ({}), formatCommunicationsBriefRecommendation: () => '' },
    '@/lib/strategicGovernance.mjs': { buildStrategicGovernance: () => ({}) },
    '@/lib/reportingDataset.mjs': { buildReportingDataset: () => ({}), filterReportingDataset: () => ({}) },
    '@/lib/articleSearch.mjs': { articleMatchesSearch: () => true },
    recharts: new Proxy({}, { get: () => hostComponent }),
  };
  const bindings = await loadBindings();
  const compiled = await bindings.transform(source, {
    filename: 'DashboardClient.js',
    jsc: {
      parser: { syntax: 'ecmascript', jsx: true },
      transform: { react: { runtime: 'automatic' } },
      target: 'es2022',
    },
    module: { type: 'commonjs' },
  });
  const moduleRecord = { exports: {} };
  const fixedNow = Date.parse('2026-08-04T12:00:00.000Z');
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [fixedNow])); }
    static now() { return fixedNow; }
  }
  const controlledRequire = (specifier) => {
    assert.ok(specifier in modules, `Unexpected module import in component harness: ${specifier}`);
    return modules[specifier];
  };
  const evaluate = new Function('require', 'module', 'exports', 'process', 'Date', compiled.code);
  evaluate(controlledRequire, moduleRecord, moduleRecord.exports, { env: {} }, FixedDate);
  return { SocialView: moduleRecord.exports.SocialView, renderer };
}

const baseSocialResult = {
  id: 'actionable-result',
  provider: 'apify',
  externalThreadId: 'provider-thread-42',
  socialAccountId: 'official-facebook',
  districtId: 'district-a',
  platform: 'facebook',
  relationshipType: 'owned',
  relationshipLabel: 'Official district post',
  visibilityStatus: 'active',
  reviewVersion: 7,
  date: '2026-08-03T12:00:00.000Z',
  headline: 'Actionable official post',
  summary: 'Actionable official post summary',
  authorName: 'District A',
  mediaType: 'text',
  mediaUrl: '',
  videoUrl: '',
  url: 'https://example.test/actionable',
  isTextOnly: true,
  isSharedPost: false,
  carouselCount: 0,
  reactionCount: 12,
  commentCount: 3,
  replyCount: 0,
  shareCount: 2,
  viewCount: 100,
  engagementTotal: 17,
  hasPerformanceData: true,
  metricAvailability: { reactions: true, comments: true, shares: true, views: true },
  representativeComments: [],
  actionIntelligence: {
    actionType: 'respond', actionLabel: 'Respond', urgency: 'today', confidence: 0.9,
    recommendedAction: 'Reply after review.', situationSummary: 'A response is warranted.',
    strategicPriorityLabels: [], missionOrValueEvidence: [], factsToVerify: [],
  },
};
const excludedSocialResult = {
  ...baseSocialResult,
  id: 'excluded-result',
  externalThreadId: 'provider-thread-99',
  reviewVersion: 11,
  visibilityStatus: 'excluded',
  date: '2026-07-01T12:00:00.000Z',
  headline: 'Previously hidden result',
  summary: 'Previously hidden result',
  actionIntelligence: null,
};
const mentionResult = {
  ...baseSocialResult,
  id: 'public-mention',
  externalThreadId: 'provider-mention-1',
  relationshipType: 'direct',
  relationshipLabel: 'Public mention',
  date: '2026-08-02T12:00:00.000Z',
  headline: 'Public mention should stay out of official reporting',
  summary: 'Public mention should stay out of official reporting',
  actionIntelligence: null,
};
const missingProviderResult = {
  ...baseSocialResult,
  id: 'missing-provider',
  provider: '',
  externalThreadId: 'provider-thread-without-provider',
  date: '2026-07-03T12:00:00.000Z',
  headline: 'Missing provider result',
  summary: 'Missing provider result',
  actionIntelligence: null,
};
const missingExternalIdResult = {
  ...baseSocialResult,
  id: 'missing-external-id',
  externalThreadId: '',
  date: '2026-07-02T12:00:00.000Z',
  headline: 'Missing external ID result',
  summary: 'Missing external ID result',
  actionIntelligence: null,
};
const sourceFixture = [{
  id: 'official-facebook', district_id: 'district-a', platform: 'facebook', active: true,
  handle: 'districta', profile_url: 'https://facebook.example/districta', metadata: { followers_count: 500 },
}];
const districtsFixture = [{ id: 'district-a', name: 'District A' }, { id: 'district-b', name: 'District B' }];
const historyFixture = Array.from({ length: 105 }, (_, index) => ({
  id: `event-${index}`,
  action: index % 2 ? 'exclude' : 'restore',
  district_id: 'district-a',
  social_thread_id: `thread-${index}`,
  resulting_version: index + 1,
  created_at: `2026-08-03T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
  after_state: { headline: `Correction event ${index}` },
  before_state: {},
}));
const reviewCalls = [];
const windowStub = {
  location: { reload() {} },
  localStorage: { getItem: () => null, setItem() {} },
  setTimeout: (callback) => { callback(); return 1; },
  clearTimeout() {},
  addEventListener() {},
};
const documentStub = { querySelectorAll: () => [] };
globalThis.window = windowStub;
globalThis.document = documentStub;

const { SocialView, renderer } = await compileSocialViewForInteractionTest(dashboard, async (payload) => reviewCalls.push(payload));
assert.equal(typeof SocialView, 'function', 'The compiled DashboardClient must expose its real SocialView component.');
const socialProps = {
  socialResults: [baseSocialResult, excludedSocialResult, mentionResult, missingProviderResult, missingExternalIdResult],
  socialSources: sourceFixture,
  socialReviewEvents: historyFixture,
  districtFilter: 'district-a',
  districts: districtsFixture,
  campaignSearch: '',
  setCampaignSearch() {},
  isAdmin: true,
};
let socialTree = renderer.render(SocialView, socialProps);
let overviewButton = findButton(socialTree, 'Our Social');
let feedButton = findButton(socialTree, 'Public conversation');
assert.equal(overviewButton.props['aria-pressed'], true);
assert.equal(feedButton.props['aria-pressed'], false);
assert.match(nodeText(socialTree), /Actionable official post/);
assert.doesNotMatch(nodeText(socialTree), /Public mention should stay out of official reporting/);

feedButton.props.onClick();
socialTree = renderer.render(SocialView, socialProps);
overviewButton = findButton(socialTree, 'Our Social');
feedButton = findButton(socialTree, 'Public conversation');
assert.equal(overviewButton.props['aria-pressed'], false);
assert.equal(feedButton.props['aria-pressed'], true);
assert.match(nodeText(socialTree), /What the world is saying about us/);
assert.match(nodeText(socialTree), /Public mention should stay out of official reporting/);
assert.doesNotMatch(nodeText(socialTree), /Actionable official post/);
assert.match(nodeText(socialTree), /Public conversation table/);
findButton(socialTree, 'All results').props.onClick();
socialTree = renderer.render(SocialView, socialProps);
findButton(socialTree, 'Cards').props.onClick();
socialTree = renderer.render(SocialView, socialProps);

const actionableCard = findNodes(socialTree, (node) => node.type === 'article' && nodeText(node).includes('Actionable official post'))
  .find((node) => findNodes(node, (child) => child.type === 'button' && nodeText(child) === 'Hide as irrelevant').length === 1);
const excludedCard = findNodes(socialTree, (node) => node.type === 'article' && nodeText(node).includes('Previously hidden result'))
  .find((node) => findNodes(node, (child) => child.type === 'button' && nodeText(child) === 'Restore').length === 1);
assert.ok(actionableCard, 'An actionable admin result with provider identifiers must expose the hide correction.');
assert.ok(excludedCard, 'An excluded admin result with provider identifiers must expose the restore correction.');
for (const ineligibleHeadline of ['Missing provider result', 'Missing external ID result']) {
  const ineligibleCard = findNodes(socialTree, (node) => node.type === 'article' && nodeText(node).includes(ineligibleHeadline))[0];
  assert.ok(ineligibleCard, `Expected to render ${ineligibleHeadline}.`);
  assert.equal(findNodes(ineligibleCard, (node) => node.props?.['aria-label'] === 'Social correction controls').length, 0);
}
await findButton(actionableCard, 'Hide as irrelevant').props.onClick();
await findButton(excludedCard, 'Restore').props.onClick();
assert.deepEqual(reviewCalls, [
  { socialThreadId: 'actionable-result', action: 'exclude', expectedVersion: 7 },
  { socialThreadId: 'excluded-result', action: 'restore', expectedVersion: 11 },
]);
assert.equal(baseSocialResult.provider, 'apify');
assert.equal(baseSocialResult.externalThreadId, 'provider-thread-42');
assert.equal(excludedSocialResult.provider, 'apify');
assert.equal(excludedSocialResult.externalThreadId, 'provider-thread-99');

const nonAdminHarness = await compileSocialViewForInteractionTest(dashboard, async () => assert.fail('A non-admin must never invoke reviewSocialThread.'));
let nonAdminTree = nonAdminHarness.renderer.render(nonAdminHarness.SocialView, { ...socialProps, isAdmin: false });
findButton(nonAdminTree, 'Public conversation').props.onClick();
nonAdminTree = nonAdminHarness.renderer.render(nonAdminHarness.SocialView, { ...socialProps, isAdmin: false });
findButton(nonAdminTree, 'All results').props.onClick();
nonAdminTree = nonAdminHarness.renderer.render(nonAdminHarness.SocialView, { ...socialProps, isAdmin: false });
findButton(nonAdminTree, 'Cards').props.onClick();
nonAdminTree = nonAdminHarness.renderer.render(nonAdminHarness.SocialView, { ...socialProps, isAdmin: false });
assert.equal(findNodes(nonAdminTree, (node) => node.props?.['aria-label'] === 'Social correction controls').length, 0);
assert.equal(findNodes(nonAdminTree, (node) => node.type === 'button' && ['Hide as irrelevant', 'Restore'].includes(nodeText(node))).length, 0);

assert.match(nodeText(socialTree), /Showing 100 of 105 correction events/);
assert.equal(findNodes(socialTree, (node) => node.type === 'article' && nodeText(node).includes('Correction event ')).length, 100);
assert.doesNotMatch(nodeText(socialTree), /Correction event 104/);
findButton(socialTree, 'Load 100 more correction events').props.onClick();
socialTree = renderer.render(SocialView, socialProps);
assert.match(nodeText(socialTree), /Showing 105 of 105 correction events/);
assert.equal(findNodes(socialTree, (node) => node.type === 'article' && nodeText(node).includes('Correction event ')).length, 105);
assert.match(nodeText(socialTree), /Correction event 104/);
assert.equal(findNodes(socialTree, (node) => node.type === 'button' && nodeText(node).includes('Load 100 more correction events')).length, 0);

const districtBEvents = historyFixture.map((event) => ({ ...event, id: `b-${event.id}`, district_id: 'district-b' }));
socialTree = renderer.render(SocialView, { ...socialProps, districtFilter: 'district-b', socialReviewEvents: districtBEvents });
socialTree = renderer.render(SocialView, { ...socialProps, districtFilter: 'district-b', socialReviewEvents: districtBEvents });
assert.match(nodeText(socialTree), /Showing 100 of 105 correction events/);
socialTree = renderer.render(SocialView, socialProps);
assert.match(nodeText(socialTree), /Showing 100 of 105 correction events/);

assert.match(sql, /visibility_status in \('review', 'approved', 'active', 'excluded'\)/);
assert.match(sql, /social_review_events_immutable/);
assert.match(sql, /before_state jsonb not null/);
assert.match(sql, /after_state jsonb not null/);
assert.match(sql, /relationship_type = 'owned'[\s\S]*visibility_status in \('review', 'approved'\)/);
assert.match(sql, /set visibility_status = 'active'/);
assert.match(sql, /canary_assert_social_reviewer/);
assert.match(sql, /raw_app_meta_data ->> 'role'/);
assert.match(sql, /account\.id = social_threads\.social_account_id/);
assert.match(sql, /account\.active = true/);
assert.match(sql, /revoke all on function public\.canary_review_social_thread[\s\S]*from public, anon, authenticated/);
assert.match(sql, /revoke all on function public\.canary_bulk_review_social_threads[\s\S]*from public, anon, authenticated/);

assert.match(actions, /function assertCanaryReviewer/);
assert.match(actions, /if \(!actor\.isAdmin\)/);
assert.match(actions, /SOCIAL_CORRECTION_ACTIONS = new Set\(\['exclude', 'restore'\]\)/);
assert.match(actions, /Unsupported social correction action/);
assert.match(actions, /supabase\.rpc\('canary_apply_social_correction'/);
assert.doesNotMatch(actions, /canary_review_social_thread|canary_bulk_review_social_threads/);
assert.doesNotMatch(actions, /approve_official|runReviewAction|runBulkAction|expectedCurrentVersion/);
assert.match(sql, /p_action not in \('approve', 'promote'/);
assert.match(sql, /p_action not in \('approve_official', 'promote'\)/);
assert.doesNotMatch(actions, /Only approved results can be promoted/);
for (const marker of ['Our Social', 'Public conversation', 'Hide as irrelevant', 'Correction history', 'Table', 'Cards', 'Official district post', 'Public mention']) {
  assert.ok(dashboard.includes(marker), `Dashboard must include ${marker}`);
}
assert.match(dashboard, /export function SocialView\(/);
assert.match(dashboard, /const \[correctionHistoryPage, setCorrectionHistoryPage\] = useState\(\{ districtFilter, limit: 100 \}\)/);
assert.match(dashboard, /useEffect\(\(\) => \{[\s\S]*?setCorrectionHistoryPage\(\{ districtFilter, limit: 100 \}\);[\s\S]*?\}, \[districtFilter\]\);/);
assert.doesNotMatch(dashboard, /if \(correctionHistoryPage\.districtFilter !== districtFilter\) \{\s*setCorrectionHistoryPage/);
assert.match(dashboard, /Showing \{visibleReviewEvents\.length\} of \{scopedReviewEvents\.length\} correction events/);
assert.match(dashboard, /Load 100 more correction events/);
assert.doesNotMatch(dashboard, /scopedReviewEvents\.slice\(0, 100\)/);
assert.match(dashboard, /const \[socialPageTab, setSocialPageTab\] = useState\('overview'\)/);
assert.match(dashboard, /const \[socialFeedViewMode, setSocialFeedViewMode\] = useState\('table'\)/);
assert.match(dashboard, /aria-label="Social page sections"/);
assert.match(dashboard, /correctionEnabled=\{isAdmin && Boolean\(result\.provider && result\.externalThreadId\)\}/);
assert.match(dashboard, /applyReviewAction\('exclude'\)[\s\S]*Hide as irrelevant/);
assert.match(dashboard, /applyReviewAction\('restore'\)[\s\S]*>Restore</);
assert.match(dashboard, /Immutable correction history retains recorded exclusions and restorations/);
assert.doesNotMatch(dashboard, /historical approvals/);
assert.match(dashboard, /<details className="social-monthly-analyst-note social-monthly-analyst-note-top">/);
assert.doesNotMatch(dashboard, /Approve for client and reports|Select eligible official posts|Review audit history|Needs approval|Bulk social review actions|Action Queue|review feed|reviewed owned posts/);
assert.doesNotMatch(dashboard, /bulkReviewSocialThreads|socialActionFilterMatches|actionFilter|onToggleSelected|social-review-select/);
assert.doesNotMatch(dashboard, /Promote to client|Promote approved batch|Approved internally/);
assert.match(dashboard, /Social cues include all enriched results for the selected district/);
assert.match(dashboard, /View Social posts\s*<\/button>/);
assert.doesNotMatch(dashboard, /Open Social Action Queue/);
assert.match(styles, /\.social-page-tabs[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(styles, /\.btn:focus-visible\s*\{[^}]*outline:\s*[2-9]px\s+solid\s+var\(--canary-yellow(?:-light)?\);[^}]*outline-offset:\s*[2-9]px;/);
assert.match(styles, /\.social-correction-controls/);
assert.match(styles, /\.social-monthly-analyst-note > summary/);
assert.match(styles, /@media print[\s\S]*\.social-report \.social-native-account-metrics[\s\S]*page-break-inside: avoid/);
assert.match(styles, /@media \(max-width: 768px\)[\s\S]*\.social-page-tabs[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);

const socialReportSource = dashboard.slice(dashboard.indexOf('function SocialReportThumbnail'), dashboard.indexOf('function BoardReportView'));
for (const marker of [
  'Social Media Performance Report',
  'Executive scorecards',
  'Official posts published',
  'Comparable public interactions',
  'Average comparable interactions',
  'Reported views',
  'Available for',
  'Top Performers',
  'Complete Post Evidence',
  'Social Media Brief',
  'complete eligible post table',
  'Not available',
]) {
  assert.ok(socialReportSource.includes(marker), `Social Report must include ${marker}`);
}
assert.match(socialReportSource, /safeSocialUrl\(result\.url\)/);
assert.match(socialReportSource, /socialReportInteractionTotal\(result\)/);
assert.match(socialReportSource, /ranked \? 'Rank' : 'Row'/);
assert.match(socialReportSource, /topPerformerGroups\.map/);
assert.match(socialReportSource, /<SocialReportTable results=\{group\.posts\} ranked \/>/);
assert.doesNotMatch(socialReportSource, /news|evidence appendix|Strategic Alignment/i);
assert.doesNotMatch(socialReportSource, /Official Post Detail|Complete detail for every eligible post/);
for (const marker of ['Monthly Social Performance', 'Latest completed month', 'Campaign or topic', 'Platform performance', 'Content format', 'Leadership highlights', 'All official posts', 'Sort posts', 'Open post ↗', 'Social Media Brief', 'Authorized Meta post and account snapshots are connected']) {
  assert.ok(dashboard.includes(marker), `Monthly Social Performance must include ${marker}`);
}
assert.match(dashboard, /const \[postTableSort, setPostTableSort\] = useState\('newest'\)/);
assert.match(dashboard, /sortedPosts\.map/);
assert.match(dashboard, /function SocialReportCard/);
assert.match(dashboard, /social-report-media-backdrop/);
assert.match(dashboard, /social-report-media-image/);
assert.match(styles, /\.social-monthly-top-posts \.board-report-social \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
assert.match(styles, /\.social-monthly-top-posts \.social-report-card \{ grid-template-columns: minmax\(150px, 0\.42fr\) minmax\(0, 1fr\); \}/);
assert.match(styles, /\.social-report-media-backdrop[\s\S]*object-fit: cover/);
assert.match(styles, /\.social-report-media-image[\s\S]*object-fit: contain/);
assert.match(styles, /@media print[\s\S]*\.social-monthly-top-posts \.social-report-card \{ grid-template-columns: minmax\(0, 1fr\); \}/);
assert.match(styles, /@media print[\s\S]*\.social-report-media-backdrop \{ display: none; \}/);
assert.doesNotMatch(dashboard, /\{false && <>/);
assert.match(dashboard, /socialPageTab === 'feed'/);
assert.doesNotMatch(dashboard, /isAdmin \|\| summary\.ambient > 0/);
assert.match(dashboard, /function formatSocialComparison\(change\)[\s\S]*Intl\.NumberFormat\('en-US'/);
assert.doesNotMatch(dashboard, /formatSocialComparison\(change\)[\s\S]{0,500}formatSocialMetric\(change\.absolute\)/);
assert.match(dashboard, /useState\('this-month'\)/);
assert.match(dashboard, /resolveSocialReportComparisonWindow\(topPostsPeriod/);
assert.match(dashboard, /previousSocialReportPosts/);
assert.match(dashboard, /analystNote=\{socialAnalystNote\}/);
assert.match(dashboard, /This report includes leadership highlights and the complete eligible post table/);
assert.match(dashboard, /<SocialReportTable results=\{allPosts\} \/>/);
assert.match(dashboard, /function SocialReportView/);
assert.match(dashboard, /monthlyReportCandidates\.filter\(\(result\) => isEligibleSocialReportPost\(result, topPostsWindow\)[\s\S]*verifiedOfficialSourceKeys\.has/);
assert.match(dashboard, /monthlyReportCandidates\.filter\(\(result\) => isEligibleSocialReportPost\(result, comparisonPostsWindow\)/);
assert.doesNotMatch(dashboard, /visibleResults\.filter\(\(result\) => isEligibleSocialReportPost/);
assert.match(dashboard, /All verified official platforms/);
assert.match(dashboard, /Campaign\/topic:/);
assert.match(dashboard, /analystNoteScopeKey = `\$\{districtFilter\}\|\$\{topPostsPeriod\}/);
assert.match(dashboard, /reportPeriod = `\$\{topPostsWindow\.label\}/);
assert.match(dashboard, /Choose one district before exporting a Social Report/);
assert.match(dashboard, /setSocialReportMode\(true\)/);
assert.doesNotMatch(dashboard, /function exportSocialPdf\(\)[\s\S]{0,250}setCurrentView\('dashboard'\)/);
assert.match(dashboard, /source\.id === result\.socialAccountId/);
assert.match(dashboard, /source\.active === true/);
assert.match(dashboard, /const SHOW_GLOBAL_BOARD_REPORT_EXPORT = false/);
assert.match(dashboard, /SHOW_GLOBAL_BOARD_REPORT_EXPORT && \['dashboard', 'birdseye', 'social'\]/);
assert.match(dashboard, /Export Leadership \/ Board PDF/);
assert.doesNotMatch(dashboard, /⬇ Export PDF[\s\S]{0,180}Tabloid landscape works best/);
assert.doesNotMatch(dashboard, /function handleExportPdf/);
assert.match(dashboard, /function BirdEyeView\(\{[\s\S]*districtId[\s\S]*districtName[\s\S]*socialResults[\s\S]*socialSources/);
assert.match(dashboard, /selectOfficialSocialReportPosts\([\s\S]*socialResults[\s\S]*socialSources[\s\S]*districtId[\s\S]*reportWindow[\s\S]*3/);
assert.match(dashboard, /Top 3 official social posts/);
assert.match(dashboard, /ranked by provider-reported interactions/);
assert.match(dashboard, /Missing metrics remain unavailable and are never treated as zero/);
assert.match(dashboard, /socialReportPosts\.map\(\(result, index\)/);
assert.match(dashboard, /canary-social-performance-/);
assert.match(dashboard, /socialReportPosts\.map\(\(result\) => socialCsvRow/);
assert.doesNotMatch(dashboard, /latestObservedAt/);
assert.match(dashboard, /metric\.value !== null && metric\.value !== undefined/,'native metric display must not coerce null values to zero');
assert.match(dashboard, /nativeSocialScopeLabel\(nativeSocialMetric\(result, 'views'\)\)/,'CSV attribution scope must use human-facing labels');
assert.match(dashboard, /nativeSocialWindowLabel\(metric\)/,'native account cells must show each metric source period');
assert.match(dashboard, /<strong>Metric-specific<\/strong><small>See each metric cell<\/small>/,'account rows must not imply a shared source window');
assert.match(dashboard, /Complete reactions, comments, and shares for \$\{summary\.interactionsAvailable\} of \$\{summary\.officialPosts\} posts/,'interaction totals and averages must disclose the complete-metric denominator');
assert.match(dashboard, /Top 3 per platform ranked by provider-reported reactions, comments, and shares/,'Top Performer ranking must disclose its metric basis');
assert.match(dashboard, /group\.rankingBasis === 'partial-only'/,'partial-only platforms need explicit fallback disclosure');
assert.match(dashboard, /Comparable totals and averages include only posts with complete reported reactions, comments, and shares/,'report notes must explain comparable aggregate inclusion');
assert.match(dashboard, /Top Performer rankings use provider-reported components and leave missing values N\/A rather than treating them as zero/,'report notes must explain partial ranking semantics');
for (const marker of ['Views observed at', 'Viewers / reach observed at', 'Reactions observed at', 'Comments observed at', 'Shares observed at', 'Clicks observed at', 'Saves observed at', 'Reposts observed at']) assert.ok(dashboard.includes(marker), `Social CSV must include per-metric timestamp: ${marker}`);
for (const marker of ['Views availability', 'Viewers / reach availability', 'Reactions availability', 'Comments availability', 'Shares availability', 'Clicks availability', 'Saves availability', 'Reposts availability']) assert.ok(dashboard.includes(marker), `Social CSV must include per-metric availability: ${marker}`);
assert.match(dashboard, /metricValue\('comments'\)/);
assert.match(dashboard, /interactionTotal \?\? 'N\/A'/);
assert.match(dashboard, /Comments \/ Replies/);
assert.match(dashboard, /hasCompleteInteractionMetrics/);
assert.match(dashboard, /neutralizeSpreadsheetFormula\(rawText\)/);
assert.match(dashboard, /const articleUrl = safeExternalHttpUrl\(article\.link\)/);
assert.match(dashboard, /Available for \{reportScores\.length\} of \{totalMentions\} mentions/);
assert.match(dashboard, /const earnedCount = newsArticles\.filter\(\(article\) => isEarned\(article\)\)\.length/);
assert.match(dashboard, /buildReportingDataset, filterReportingDataset/);
assert.match(dashboard, /const reportingDataset = useMemo/);
assert.match(dashboard, /articles: reportingArticles/);
assert.match(dashboard, /\[articles, noteOverrides\]/);
assert.match(dashboard, /filterReportingDataset\(reportingDataset, \{ districtId: districtFilter, campaignSearch \}\)/);
assert.match(dashboard, /return campaignArticles\.filter/);
assert.match(dashboard, /const reportScores = chartArticles[\s\S]*\.filter\(Number\.isFinite\)/);
assert.match(dashboard, /className="campaign-overview"/);
assert.match(dashboard, /campaignSearch=\{campaignSearch\}/);
assert.match(dashboard, /setCampaignSearch=\{setCampaignSearch\}/);
assert.match(dashboard, /Campaign: \{campaignSearch\} ✕/);
assert.match(dashboard, /socialResults=\{campaignSocialResults\}/);
assert.match(dashboard, /legacySocialResults=\{campaignSuppressedLegacySocialResults\}/);
assert.match(dashboard, /isAdmin && legacySocialResults\.length > 0/);
assert.match(dashboard, /Legacy import reference/);
assert.match(dashboard, /excluded from client Social totals, feeds, and reports/);
assert.doesNotMatch(dashboard, /Archived social evidence/);
for (const marker of ['Our Social', 'What we are saying about ourselves', 'Public conversation', 'What the world is saying about us', 'Export filtered CSV', 'Filtered public conversation']) {
  assert.ok(dashboard.includes(marker), `Social information hierarchy must include ${marker}`);
}
assert.match(dashboard, /useState\('public'\)/);
assert.match(dashboard, /useState\('table'\)/);
assert.match(dashboard, /visibleResults\.map\(\(result\) => socialCsvRow/);
assert.match(dashboard, /<tbody>\{visibleResults\.map/);
assert.match(dashboard, /socialFeedViewMode === 'cards' && pagedResults\.length < visibleResults\.length/);
assert.doesNotMatch(dashboard, /Top district posts by platform/);
assert.match(dashboard, /scoreFilterIsDefault/);
assert.match(dashboard, /scoreCount: 0/);
assert.match(dashboard, /w\.scoreSum \/ w\.scoreCount/);
assert.doesNotMatch(dashboard, /w\.scoreSum \/ w\.mentions/);
assert.match(dashboard, /function formatCanaryScore\(score\)/);
assert.doesNotMatch(dashboard, /parseFloat\(article\.canary_score\)\.toFixed/);
assert.doesNotMatch(dashboard, /Number\(article\.canary_score\)\.toFixed/);
assert.match(styles, /\.score-badge\.unavailable/);
assert.match(dashboard, /Showing \{filtered\.length\} of \{scopedArticlesForCounts\.length\} media articles/);
assert.match(dashboard, /SOCIAL_ANALYST_DRAFTS_STORAGE_KEY/);
assert.match(dashboard, /window\.localStorage\.setItem\(SOCIAL_ANALYST_DRAFTS_STORAGE_KEY/);
const monthlyPerformanceSource = dashboard.slice(dashboard.indexOf('function MonthlySocialPerformance'), dashboard.indexOf('function SocialView'));
assert.ok(
  monthlyPerformanceSource.indexOf('social-monthly-analyst-note-top') < monthlyPerformanceSource.indexOf('social-monthly-controls'),
  'The editable analyst insight must appear before report controls and scorecards.',
);
const socialReportViewSource = dashboard.slice(dashboard.indexOf('function SocialReportView'), dashboard.indexOf('function BoardReportView'));
assert.ok(
  socialReportViewSource.indexOf('social-report-analyst-note') < socialReportViewSource.indexOf('social-report-scorecards'),
  'The saved analyst insight must appear before scorecards in the exported report.',
);
assert.match(styles, /\.campaign-overview[\s\S]*grid-template-columns/);
assert.match(styles, /\.social-monthly-analyst-note-top/);
assert.match(dashboard, /<SocialReportMetric result=\{result\} metric="reactions"/);
const socialReportCardSource = dashboard.slice(dashboard.indexOf('function SocialReportCard'), dashboard.indexOf('function SocialReportThumbnail'));
for (const metric of ['reactions', 'comments', 'shares']) {
  assert.ok(socialReportCardSource.includes(`metric="${metric}"`), `Board social cards must honor ${metric} availability`);
}
assert.match(socialReportCardSource, /socialReportInteractionTotal\(result\) === null \? 'Not available'/);
assert.match(styles, /\.social-report-mode > \*:not\(\.social-report\)/);
assert.match(styles, /\.social-report-mode \.social-report/);
assert.match(styles, /\.social-report-table thead \{ display: table-header-group; \}/);
assert.match(styles, /\.social-report-thumbnail img[\s\S]*object-fit: contain/);
assert.match(styles, /\.social-report-table th,[\s\S]*overflow-wrap: anywhere/);
assert.doesNotMatch(styles, /\.social-report-grid/);
assert.match(styles, /input\[type="date"\][\s\S]*color-scheme: dark/);
assert.match(styles, /\.birdseye-report-controls[\s\S]*display: none !important/);
assert.match(styles, /\.birdseye-evidence-page[\s\S]*break-before: page/);
assert.match(styles, /\.birdseye-evidence-table thead[\s\S]*display: table-header-group/);
assert.match(styles, /\.birdseye-evidence-table \.headline-text,[\s\S]*-webkit-line-clamp: unset !important/);
assert.match(styles, /\.board-report-social \.social-report-media-image[\s\S]*object-fit: contain/);
assert.match(dashboard, /!listCompact && \(/);
assert.match(data, /includeReview \? \['active', 'excluded'\] : \['active'\]/);
assert.match(data, /export async function getSocialReviewEvents/);
assert.match(melodi, /\.eq\('visibility_status', 'active'\)/);
assert.doesNotMatch(melodi, /const socialVisibility|\.in\('visibility_status', socialVisibility\)/);

console.log('Social review workflow tests passed.');
