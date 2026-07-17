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

const dashboard = await readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
assert.match(dashboard, /canary_columns_v3/);
assert.match(dashboard, /legacySaved[\s\S]*next\.add\('earned_media'\)/);
assert.ok(
  dashboard.indexOf("id: 'earned_media'") < dashboard.indexOf("id: 'innovation_reason'"),
  'Earned Media should appear before Strategic Alignment in the main table',
);
assert.match(dashboard, /Add \/ Correct Stories/);
assert.match(dashboard, /\+ Add Story/);
assert.match(dashboard, /setCurrentView\('corrections'\)/);

console.log('Manual story correction tests passed.');
