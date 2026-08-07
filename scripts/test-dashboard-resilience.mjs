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
]) {
  assert.match(page, new RegExp(`loadDashboardDataset\\('${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
}
assert.match(page, /dataWarnings=\{dataWarnings\}/);
assert.match(page, /const dataDistrictId = userDistrictId \|\| \(initialDistrictId === 'All' \? null : initialDistrictId\)/);
assert.match(page, /getArticles\(dataDistrictId\)/);
assert.match(page, /initialDistrictId=\{initialDistrictId\}/);
assert.match(dashboard, /Some dashboard data could not load/);
assert.match(errorBoundary, /Dashboard could not finish loading/);
assert.match(errorBoundary, /onClick=\{reset\}/);
assert.match(dashboard, /before relying on the displayed totals/);
assert.match(dashboard, /window\.location\.assign\(`\/dashboard\?\$\{params\.toString\(\)\}`\)/);
assert.match(data, /groupStart < threads\.length; groupStart \+= 400/);
assert.match(data, /Array\.from\(\{ length: 4 \}/);
assert.match(data, /export async function getRecentSocialReviewEvents[\s\S]*?\.limit\(500\)/);

console.log('Dashboard resilience structural tests passed.');
