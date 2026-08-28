import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [page, dashboard] = await Promise.all([
  readFile(new URL('../src/app/dashboard/page.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8'),
]);

assert.match(
  page,
  /isAdmin\s*\?\s*loadDashboardDataset\('Collection health',[\s\S]*?:\s*Promise\.resolve\(\{ data: \[\], warning: null \}\)/,
  'News collection-health telemetry must be loaded only for admins',
);
assert.match(
  page,
  /isAdmin\s*\?\s*loadDashboardDataset\('Social collection health',[\s\S]*?:\s*Promise\.resolve\(\{ data: \[\], warning: null \}\)/,
  'Public Social collection-health telemetry must be loaded only for admins',
);
assert.match(
  dashboard,
  /const showOperationalCollectionHealth = isAdmin && !demoMode;/,
  'operational collection-health presentation must use an explicit admin-only gate',
);
assert.match(
  dashboard,
  /showOperationalCollectionHealth\s*\?\s*\(selectedCollectionHealth\?\.label \?\? 'Collection status unavailable'\)\s*:\s*'Based on active filters'/,
  'client Total Mentions card must use neutral product copy',
);
assert.match(
  dashboard,
  /\{showOperationalCollectionHealth && \(<>[\s\S]*?News collection health[\s\S]*?Public Social collection health[\s\S]*?<\/>\)\}/,
  'News and Public Social operational health banners must be behind the admin-only gate',
);

console.log('Client collection-health visibility test passed.');
