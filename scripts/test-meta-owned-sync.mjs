import assert from 'node:assert/strict';
import {
  boundedMetaSourceCutoff,
  mapFacebookPagePosts,
  mapInstagramMedia,
  summarizeMetaSyncOutcome,
  validateMetaSyncSelection,
} from '../src/lib/meta-owned-sync.mjs';

const districtId = 'district-a';
const fixedNow = new Date('2026-08-13T22:00:00Z');
assert.equal(boundedMetaSourceCutoff(null, fixedNow), '2026-05-15T22:00:00.000Z');
assert.equal(boundedMetaSourceCutoff('2025-01-01T00:00:00Z', fixedNow), '2026-05-15T22:00:00.000Z');
assert.equal(boundedMetaSourceCutoff('2026-08-01T00:00:00Z', fixedNow), '2026-08-01T00:00:00.000Z');
assert.throws(() => boundedMetaSourceCutoff('not-a-date', fixedNow), /valid past timestamp/);
const facebook = mapFacebookPagePosts({
  districtId,
  asset: { id: 'asset-page', provider_asset_id: 'page-1', name: 'District Page', handle: 'district' },
  rows: [{
    id: 'page-1_100', message: 'School opens Monday', created_time: '2026-08-13T12:00:00Z',
    permalink_url: 'https://www.facebook.com/district/posts/100',
    from: { id: 'page-1', name: 'District Page' }, comments: { summary: { total_count: 4 } },
    reactions: { summary: { total_count: 9 } }, shares: { count: 2 },
  }],
});
assert.equal(facebook.status, 'success');
assert.equal(facebook.threads.length, 1);
assert.deepEqual(
  Object.fromEntries(Object.keys({
    district_id: 1, provider: 1, platform: 1, external_thread_id: 1, relationship_type: 1,
    comment_count: 1, reaction_count: 1, share_count: 1, engagement_total: 1, visibility_status: 1,
  }).map((key) => [key, facebook.threads[0][key]])),
  {
    district_id: districtId,
    provider: 'meta',
    platform: 'facebook',
    external_thread_id: 'page-1_100',
    relationship_type: 'owned',
    comment_count: 4,
    reaction_count: 9,
    share_count: 2,
    engagement_total: 15,
    visibility_status: 'active',
  },
);
assert.equal(facebook.threads[0].provider_metadata.provider_asset_id, 'asset-page');

const instagram = mapInstagramMedia({
  districtId,
  asset: { id: 'asset-ig', provider_asset_id: 'ig-1', name: 'District Instagram', handle: 'districtschools' },
  rows: [{ id: 'ig-media-1', caption: 'First day', timestamp: '2026-08-13T13:00:00Z', permalink: 'https://www.instagram.com/p/example/', comments_count: 3, like_count: 20, username: 'districtschools' }],
});
assert.equal(instagram.status, 'success');
assert.equal(instagram.threads[0].platform, 'instagram');
assert.equal(instagram.threads[0].engagement_total, 23);
assert.equal(instagram.threads[0].provider_metadata.metric_availability.shares, false);

const partial = mapFacebookPagePosts({
  districtId,
  asset: { id: 'asset-page', provider_asset_id: 'page-1', name: 'District Page' },
  rows: [{
    id: 'page-1_101', message: 'Valid update', created_time: '2026-08-13T14:00:00Z',
    permalink_url: 'https://www.facebook.com/district/posts/101', from: { id: 'page-1', name: 'District Page' },
  }, { id: 'bad' }],
});
assert.equal(partial.status, 'partial');
assert.equal(partial.threads.length, 1);
assert.equal(partial.rejected.length, 1);
assert.deepEqual(partial.threads[0].provider_metadata.metric_availability, { comments: false, reactions: false, shares: false, views: false });
assert.equal(partial.threads[0].engagement_total, 0);

const empty = mapInstagramMedia({ districtId, asset: { id: 'asset-ig', provider_asset_id: 'ig-1', name: 'IG' }, rows: [] });
assert.equal(empty.status, 'empty');
const failed = mapInstagramMedia({ districtId, asset: { id: 'asset-ig', provider_asset_id: 'ig-1', name: 'IG' }, providerError: { code: 190, message: 'Token expired' } });
assert.equal(failed.status, 'failed');
assert.equal(failed.providerErrors, 1);

assert.deepEqual(validateMetaSyncSelection([
  { id: 'a', asset_type: 'facebook_page', selected: true, active: true },
  { id: 'b', asset_type: 'instagram_account', selected: true, active: true },
]), { facebookPages: 1, instagramAccounts: 1 });
assert.throws(() => validateMetaSyncSelection([{ id: 'x', asset_type: 'ad_account', selected: true, active: true }]), /unsupported selected Meta asset/);
assert.throws(() => validateMetaSyncSelection([{ id: 'x', asset_type: 'facebook_page', selected: false, active: true }]), /must be active and selected/);

assert.deepEqual(summarizeMetaSyncOutcome([
  { status: 'success', threads: [{}, {}], rejected: [], providerErrors: 0 },
  { status: 'empty', threads: [], rejected: [], providerErrors: 0 },
]), { status: 'success', accountsAttempted: 2, accountsSucceeded: 2, postsRead: 2, rejectedItems: 0, providerErrors: 0 });
assert.equal(summarizeMetaSyncOutcome([empty]).status, 'empty');
assert.equal(summarizeMetaSyncOutcome([{ status: 'success', threads: [{}], rejected: [], providerErrors: 0 }, failed]).status, 'partial');
assert.equal(summarizeMetaSyncOutcome([failed]).status, 'failed');

console.log('Meta owned-social normalization tests passed.');
