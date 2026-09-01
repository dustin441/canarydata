import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalizeStoryUrl, requireCorrectionReason } from '../src/lib/storyCorrections.mjs';

assert.equal(
  canonicalizeStoryUrl('https://www.Example.com/news/story/?utm_source=email&b=2&a=1#section'),
  'https://example.com/news/story?a=1&b=2',
);
assert.equal(
  canonicalizeStoryUrl('https://example.com/story?fbclid=abc'),
  'https://example.com/story',
);
assert.throws(() => canonicalizeStoryUrl('http://example.com/story'), /HTTPS/);
assert.throws(() => requireCorrectionReason('too short'), /at least 10/);
assert.equal(requireCorrectionReason('  Verified false positive  '), 'Verified false positive');

const actions = await readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8');
for (const action of ['addManualStory', 'excludeStory', 'restoreStory']) {
  assert.match(actions, new RegExp(`export async function ${action}`));
}
assert.match(actions, /assertDistrictAccess\(actor, targetDistrictId\)/);
assert.match(actions, /assertDistrictAccess\(actor, story\.district_id\)/);
assert.match(actions, /canary_add_manual_story/);
assert.match(actions, /canary_exclude_story/);
assert.match(actions, /canary_restore_story/);

const data = await readFile(new URL('../src/lib/data.js', import.meta.url), 'utf8');
assert.match(data, /\.eq\('visibility_status', 'active'\)/);
assert.match(
  data,
  /\.order\('date', \{ ascending: false \}\)\s*\.order\('id', \{ ascending: true \}\)\s*\.range\(/,
  'Paginated article reads need a stable id tie-breaker so admin and client district counts stay identical',
);

const dashboard = await readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
assert.match(dashboard, /canary_columns_v3/);
assert.match(dashboard, /legacySaved[\s\S]*next\.add\('earned_media'\)/);
assert.ok(
  dashboard.indexOf("id: 'recommendation'") < dashboard.indexOf("id: 'earned_media'"),
  'External Coverage should remain to the right of Recommendation',
);
assert.ok(
  dashboard.indexOf("id: 'earned_media'") < dashboard.indexOf("id: 'notes'"),
  'External Coverage should remain before Notes',
);
assert.match(
  dashboard,
  /col\('recommendation'\)[\s\S]*?<th>Recommendation<\/th>[\s\S]*?col\('earned_media'\)[\s\S]*?<th>External Coverage<InfoTooltip text=\{EXTERNAL_COVERAGE_TOOLTIP\} \/><\/th>[\s\S]*?col\('notes'\)/,
);
assert.match(
  dashboard,
  /\{\/\* Recommendation \*\/[\s\S]*?\{\/\* External Coverage \*\/[\s\S]*?\{\/\* Notes \*\//,
);
assert.match(dashboard, /const earnedMediaCount = chartArticles\.filter\(\(article\) => isEarned\(article\)\)\.length/);
assert.match(dashboard, /<div className="kpi-label">External Coverage<InfoTooltip text=\{EXTERNAL_COVERAGE_TOOLTIP\} \/><\/div>[\s\S]*?<div className="kpi-value">\{earnedMediaCount\}<\/div>[\s\S]*?Filtered timeframe/);
assert.match(dashboard, /STRATEGIC_ALIGNMENT_TOOLTIP[\s\S]*?affirmative district action/);
assert.match(dashboard, /formatStrategicAlignmentLabel\(label\)/);
assert.match(dashboard, /Strategic Alignment<InfoTooltip text=\{STRATEGIC_ALIGNMENT_TOOLTIP\} \/>/);
assert.match(dashboard, /Dashboard[\s\S]*?handleNavSelect\('birdseye'\)[\s\S]*?Bird’s Eye View[\s\S]*?handleNavSelect\('howto'\)/);
assert.match(dashboard, /className="chart-card strategic-performance-chart"/);
const dashboardCss = await readFile(new URL('../src/app/globals.css', import.meta.url), 'utf8');
assert.match(dashboardCss, /\.headline-cell \.headline-text[\s\S]*?-webkit-line-clamp: 3/);
assert.match(dashboardCss, /\.strategic-performance-chart[\s\S]*?grid-column: 1 \/ -1/);
assert.match(dashboard, /Add \/ Correct Stories/);
assert.match(dashboard, /\+ Add Story/);
assert.match(dashboard, /setCurrentView\('corrections'\)/);

console.log('Manual story correction tests passed.');
