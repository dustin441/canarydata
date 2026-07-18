import assert from 'node:assert/strict';
import {
  buildSocialResults,
  normalizeSocialResult,
  summarizeSocialResults,
} from '../src/lib/social.mjs';
import { normalizeProviderBatch } from '../src/lib/socialIngestion.mjs';

const legacyArticle = {
  id: 'legacy-1',
  district_id: 'alabaster-city-schools',
  source_type: 'instagram',
  source: 'Instagram',
  headline: 'Community post about Alabaster City Schools',
  summary: 'A public post discusses the district.',
  link: 'https://www.instagram.com/p/example/',
  date: '2026-07-17',
  canary_score: 7.5,
  tags: ['Engagement'],
};

const canonicalThread = {
  id: 'thread-1',
  district_id: 'alabaster-city-schools',
  platform: 'facebook',
  relationship_type: 'owned',
  author_name: 'Alabaster City Schools',
  headline: 'Back-to-school update',
  summary: 'The district shared its opening schedule.',
  canonical_url: 'https://www.facebook.com/example/posts/1',
  published_at: '2026-07-18T12:00:00Z',
  comment_count: 24,
  reply_count: 6,
  reaction_count: 120,
  share_count: 9,
  engagement_total: 159,
  match_reason: 'Published by a connected district account.',
};

const legacy = normalizeSocialResult(legacyArticle);
assert.equal(legacy.platform, 'instagram');
assert.equal(legacy.relationshipType, 'ambient');
assert.equal(legacy.url, legacyArticle.link);
assert.equal(legacy.commentCount, 0);

const canonical = normalizeSocialResult(canonicalThread);
assert.equal(canonical.relationshipType, 'owned');
assert.equal(canonical.commentCount, 24);
assert.equal(canonical.engagementTotal, 159);
assert.equal(canonical.url, canonicalThread.canonical_url);

const concise = normalizeSocialResult({
  ...canonicalThread,
  id: 'thread-2',
  recommendation: `**Monitor closely:** ${'Transportation updates should remain concise and actionable. '.repeat(12)}`,
});
assert.ok(!concise.recommendation.includes('**'));
assert.ok(concise.recommendation.length <= 321);
assert.ok(concise.recommendation.endsWith('…'));

const unsafeLink = normalizeSocialResult({ ...legacyArticle, id: 'unsafe-link', link: 'javascript:alert(1)' });
assert.equal(unsafeLink.url, null);

const results = buildSocialResults([legacyArticle, canonicalThread, { ...canonicalThread }]);
assert.equal(results.length, 2, 'duplicate platform thread IDs should collapse');
assert.equal(results[0].id, 'thread-1', 'newest social result should sort first');

const summary = summarizeSocialResults(results);
assert.deepEqual(summary, {
  total: 2,
  owned: 1,
  direct: 0,
  ambient: 1,
  totalEngagement: 159,
});

const batch = normalizeProviderBatch({
  provider: 'meta',
  districtId: 'alabaster-city-schools',
  items: [
    {
      platform: 'instagram',
      external_thread_id: 'ig-123',
      canonical_url: 'https://www.instagram.com/p/example/',
      relationship_type: 'direct_mention',
      published_at: '2026-07-18T12:00:00Z',
      body: 'A public post tagged the district.',
    },
    { platform: 'instagram', external_thread_id: 'broken' },
  ],
});
assert.equal(batch.status, 'partial');
assert.equal(batch.threads.length, 1);
assert.equal(batch.rejected.length, 1);
assert.equal(batch.threads[0].provider, 'meta');
assert.equal(batch.threads[0].district_id, 'alabaster-city-schools');

const failedBatch = normalizeProviderBatch({
  provider: 'apify',
  districtId: 'alabaster-city-schools',
  items: [],
  providerError: { code: 'ACTOR_RENTAL_EXPIRED', message: 'Actor rental expired.' },
});
assert.equal(failedBatch.status, 'failed');
assert.equal(failedBatch.providerErrors, 1);

const emptyBatch = normalizeProviderBatch({
  provider: 'meta',
  districtId: 'alabaster-city-schools',
  items: [],
});
assert.equal(emptyBatch.status, 'empty');

console.log('Social monitoring unit tests passed.');
