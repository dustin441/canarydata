import assert from 'node:assert/strict';
import {
  buildSocialResults,
  calculateSocialEngagementRate,
  normalizeSocialResult,
  rankTopSocialResults,
  resolveSocialFollowerCount,
  safeSocialMediaUrl,
  socialActionFilterMatches,
  socialDateFilterMatches,
  socialRelationshipFilterMatches,
  summarizeSocialActions,
  summarizeSocialResults,
} from '../src/lib/social.mjs';
import { normalizeProviderBatch } from '../src/lib/socialIngestion.mjs';
import { formatDisplayDate } from '../src/lib/date.mjs';

assert.equal(formatDisplayDate('2026-06-09'), 'Jun 9, 2026');
assert.equal(formatDisplayDate('2026-06-09T12:00:00Z'), 'Jun 9, 2026');
assert.equal(formatDisplayDate('not-a-date'), 'Date unavailable');

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
  provider: 'apify',
  platform: 'facebook',
  relationship_type: 'owned',
  author_name: 'Alabaster City Schools',
  headline: 'Back-to-school update',
  summary: 'The district shared its opening schedule.',
  canonical_url: 'https://www.facebook.com/example/posts/1',
  published_at: '2026-07-18T12:00:00Z',
  provider_metadata: {
    media_url: 'https://scontent-lga3-3.xx.fbcdn.net/example.jpg',
    video_url: 'https://scontent-lga3-3.xx.fbcdn.net/example.mp4',
    profile_picture_url: 'https://scontent-lga3-1.xx.fbcdn.net/avatar.jpg',
    media_type: 'video',
    shared_post: false,
    carousel_count: 1,
    is_text_only: false,
    metric_availability: { reactions: true, comments: false, shares: true, views: true },
  },
  comment_count: 24,
  reply_count: 6,
  reaction_count: 120,
  share_count: 9,
  engagement_total: 159,
  match_reason: 'Published by a connected district account.',
  social_comments: [
    {
      id: 'comment-1',
      author_name: 'Community Member',
      body: '**Will transportation details be posted soon?**',
      published_at: '2026-07-18T13:00:00Z',
      reaction_count: 2,
      is_representative: true,
    },
    {
      id: 'comment-hidden',
      body: '',
      is_representative: true,
    },
  ],
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
assert.equal(canonical.mediaUrl, 'https://scontent-lga3-3.xx.fbcdn.net/example.jpg');
assert.equal(canonical.videoUrl, 'https://scontent-lga3-3.xx.fbcdn.net/example.mp4');
assert.equal(canonical.profileImageUrl, 'https://scontent-lga3-1.xx.fbcdn.net/avatar.jpg');
assert.equal(canonical.mediaType, 'video');
assert.equal(canonical.isTextOnly, false);
assert.equal(canonical.isSharedPost, false);
assert.equal(canonical.carouselCount, 1);
assert.equal(canonical.hasPerformanceData, true);
assert.equal(canonical.metricAvailability.comments, false);
assert.equal(canonical.representativeComments.length, 1);
assert.equal(canonical.representativeComments[0].authorName, 'Community Member');
assert.equal(canonical.representativeComments[0].body, 'Will transportation details be posted soon?');
assert.equal(canonical.representativeComments[0].reactionCount, 2);
assert.equal(legacy.hasPerformanceData, false);
assert.equal(canonical.visibilityStatus, 'active');
assert.equal(normalizeSocialResult({ ...canonicalThread, visibility_status: 'review' }).visibilityStatus, 'review');
const directTag = normalizeSocialResult({ ...canonicalThread, id: 'tagged', platform: 'instagram', author_handle: '@community.partner', relationship_type: 'direct_tag' });
assert.equal(directTag.relationshipType, 'direct');
assert.equal(directTag.relationshipLabel, 'Tagged post');
assert.equal(socialRelationshipFilterMatches(directTag, 'direct'), true);
assert.equal(socialRelationshipFilterMatches(directTag, 'owned'), false);
assert.equal(socialRelationshipFilterMatches(canonical, 'owned'), true);
assert.equal(directTag.authorProfileUrl, 'https://www.instagram.com/community.partner/');

const enrichedAction = normalizeSocialResult({
  ...canonicalThread,
  id: 'enriched-action',
  relationship_type: 'ambient',
  provider_metadata: {
    ...canonicalThread.provider_metadata,
    action_intelligence: {
      action_type: 'amplify',
      urgency: 'this_week',
      audiences: ['families', 'community'],
      situation_summary: '**A community partner shared a student opportunity.**',
      action_rationale: 'The item supports a current district priority.',
      recommended_action: 'Verify the details and consider resharing.',
      draft_response: 'Thank you for supporting students.',
      content_opportunity: 'Partner recognition post.',
      strategic_priority_ids: ['priority-1'],
      strategic_priority_labels: ['Engaged stakeholders', 'Engaged stakeholders'],
      strategic_alignment_reason: 'The partner is promoting student success.',
      mission_or_value_evidence: ['Preparing students for their future.'],
      facts_to_verify: ['Confirm the event date.', 'Confirm the event date.'],
      confidence: 0.94,
      review_status: 'review',
    },
  },
});
assert.equal(enrichedAction.actionType, 'amplify');
assert.equal(enrichedAction.actionIntelligence.actionLabel, 'Amplify');
assert.equal(enrichedAction.actionIntelligence.situationSummary, 'A community partner shared a student opportunity.');
assert.deepEqual(enrichedAction.actionIntelligence.strategicPriorityLabels, ['Engaged stakeholders']);
assert.deepEqual(enrichedAction.actionIntelligence.factsToVerify, ['Confirm the event date.']);
assert.equal(socialActionFilterMatches(enrichedAction, 'amplify'), true);
assert.equal(socialActionFilterMatches(enrichedAction, 'respond'), false);
assert.deepEqual(summarizeSocialActions([enrichedAction, canonical]), {
  total: 1,
  respond: 0,
  amplify: 1,
  strategy: 0,
  monitor: 0,
  elevate: 0,
});

const missingConfidenceAction = normalizeSocialResult({
  ...canonicalThread,
  id: 'missing-confidence-action',
  provider_metadata: {
    action_intelligence: {
      action_type: 'monitor',
      confidence: null,
    },
  },
});
assert.equal(missingConfidenceAction.actionIntelligence.confidence, null);

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
assert.equal(safeSocialMediaUrl('javascript:alert(1)'), '');
assert.equal(safeSocialMediaUrl('https://example.com/tracker.png'), '');
assert.equal(safeSocialMediaUrl('https://scontent-lax3-1.cdninstagram.com/example.jpg'), 'https://scontent-lax3-1.cdninstagram.com/example.jpg');
assert.equal(safeSocialMediaUrl('https://p16-common-sign.tiktokcdn-us.com/example.jpg'), 'https://p16-common-sign.tiktokcdn-us.com/example.jpg');
assert.equal(safeSocialMediaUrl('https://v16m.tiktokcdn-us.com/example.mp4'), 'https://v16m.tiktokcdn-us.com/example.mp4');
assert.equal(safeSocialMediaUrl('https://evil-tiktokcdn-us.com/example.mp4'), '');
assert.equal(calculateSocialEngagementRate({ engagementTotal: 50 }, 1000), 5);
assert.equal(calculateSocialEngagementRate({ engagementTotal: 50 }, 0), null);
assert.equal(calculateSocialEngagementRate({ engagementTotal: 0 }, 1000), 0);
assert.equal(resolveSocialFollowerCount(canonical, { metadata: { followers_count: 4327 } }), 4327);
assert.equal(resolveSocialFollowerCount({ ...canonical, relationshipType: 'ambient' }, { metadata: { followers_count: 4327 } }), 0, 'district followers must not be used for outside authors');
assert.equal(resolveSocialFollowerCount({ ...canonical, relationshipType: 'ambient', providerMetadata: { followers: 2500 } }, { metadata: { followers_count: 4327 } }), 2500);
assert.equal(socialDateFilterMatches({ date: '2026-07-15T12:00:00Z' }, '2026-07-01', '2026-07-31'), true);
assert.equal(socialDateFilterMatches({ date: '2026-06-30T23:59:59Z' }, '2026-07-01', ''), false);
assert.equal(socialDateFilterMatches({ date: '2026-08-01T00:00:00Z' }, '', '2026-07-31'), false);

const results = buildSocialResults([legacyArticle, canonicalThread, { ...canonicalThread }]);
assert.equal(results.length, 2, 'duplicate platform thread IDs should collapse');
assert.equal(results[0].id, 'thread-1', 'newest social result should sort first');

const stagedInstagram = {
  ...canonicalThread,
  id: 'staged-instagram',
  platform: 'instagram',
  external_thread_id: 'example',
  canonical_url: 'https://www.instagram.com/p/example/',
  visibility_status: 'review',
};
const legacyDuplicate = {
  ...legacyArticle,
  id: 'legacy-duplicate',
  canonical_url: 'https://instagram.com/p/example',
};
const transitionalResults = buildSocialResults([stagedInstagram, legacyDuplicate]);
assert.equal(transitionalResults.length, 1, 'canonical permalink variants should deduplicate across staged and legacy records');
assert.equal(transitionalResults[0].visibilityStatus, 'review', 'staged record should win transitional deduplication');

const summary = summarizeSocialResults(results);
assert.deepEqual(summary, {
  total: 2,
  owned: 1,
  direct: 0,
  ambient: 1,
  totalEngagement: 159,
});

const ranked = rankTopSocialResults([
  { ...canonical, id: 'lower-engagement', engagementTotal: 10, viewCount: 900, date: '2026-07-20' },
  { ...canonical, id: 'highest-engagement', engagementTotal: 50, viewCount: 100, date: '2026-07-18' },
  { ...canonical, id: 'tie-newer', engagementTotal: 25, viewCount: 200, date: '2026-07-21' },
  { ...canonical, id: 'tie-older', engagementTotal: 25, viewCount: 200, date: '2026-07-19' },
  { ...canonical, id: 'ambient', relationshipType: 'ambient', engagementTotal: 999, viewCount: 9999 },
], 3);
assert.deepEqual(ranked.map((item) => item.id), ['highest-engagement', 'tie-newer', 'tie-older']);
assert.deepEqual(rankTopSocialResults([], 5), []);
assert.deepEqual(rankTopSocialResults([canonical], 0), []);

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
