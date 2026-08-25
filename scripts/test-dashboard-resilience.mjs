import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [page, data, dashboard, errorBoundary] = await Promise.all([
  readFile(new URL('../src/app/dashboard/page.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/data.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/dashboard/error.js', import.meta.url), 'utf8'),
]);

assert.match(page, /const DASHBOARD_DATA_TIMEOUT_MS = 6500/);
assert.match(page, /Promise\.race\(\[Promise\.resolve\(\)\.then\(loader\), timeout\]\)/);
assert.match(page, /return \{ data: fallback, warning: label \}/);
for (const label of [
  'News results',
  'Queries',
  'Client directory',
  'Excluded news results',
  'News correction history',
  'Social sources',
  'Social results',
  'Social correction history',
  'Strategic profiles',
  'Strategic priorities',
  'Collection health',
  'Social collection health',
]) {
  assert.match(page, new RegExp(`loadDashboardDataset\\('${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
}
assert.match(page, /dataWarnings=\{dataWarnings\}/);
assert.match(page, /socialCollectionHealth=\{socialCollectionHealth\}/);
assert.match(page, /if \(isAdmin && !requestedDistrictId && districts\[0\]\?\.id\)[\s\S]*redirect\(`\/dashboard\?district=/);
assert.match(page, /const dataDistrictId = isDemoReviewer[\s\S]*\? reviewerAccess\.selectedDistrictId[\s\S]*: userDistrictId \|\| \(initialDistrictId === 'All' \? null : initialDistrictId\)/);
assert.match(page, /getArticles\(dataDistrictId\)/);
assert.match(page, /initialDistrictId=\{initialDistrictId\}/);
assert.match(dashboard, /Some dashboard data could not load/);
assert.match(errorBoundary, /Dashboard could not finish loading/);
assert.match(errorBoundary, /onClick=\{reset\}/);
assert.match(dashboard, /before relying on the displayed totals/);
assert.match(dashboard, /Public Social collection health/);
assert.match(dashboard, /selectedSocialCollectionHealth\?\.latestRawItems/);
assert.match(dashboard, /function handleDashboardPdf\(\)/, 'the main dashboard PDF handler must remain available');
assert.match(dashboard, /onClick=\{handleDashboardPdf\}/, 'the main dashboard must expose its PDF trigger');
assert.match(dashboard, /Export Dashboard PDF/, 'the main dashboard PDF action must be clearly labeled');
assert.match(dashboard, /window\.setTimeout\(\(\) => window\.print\(\), 120\)/, 'dashboard PDF export must open the browser print flow after UI cleanup');
assert.match(dashboard, /window\.location\.assign\(`\/dashboard\?\$\{params\.toString\(\)\}`\)/);
assert.match(data, /groupStart < threads\.length; groupStart \+= 400/);
assert.match(data, /order\('district_id'\)\.order\('id'\)/, 'Paginated Social query and account reads must have an immutable unique tie-breaker');
assert.match(data, /Array\.from\(\{ length: 4 \}/);
assert.match(data, /export async function getRecentSocialReviewEvents[\s\S]*?\.limit\(500\)/);

console.log('Dashboard resilience structural tests passed.');
