import assert from 'node:assert/strict';
import { buildSocialAffiliatePreview, normalizeSocialHandle } from '../src/lib/social-affiliate-preview.js';

assert.equal(normalizeSocialHandle('  @@AuburnHighSoccer '), 'auburnhighsoccer');
const claim={id:'claim-1',district_id:'district-a',affiliate_type:'athletics',relationship_label:'District athletics',social_accounts:{id:'account-1',platform:'instagram',handle:'@TeamOne',display_name:'Team One',active:false}};
const threads=[
 {id:'1',district_id:'district-a',platform:'instagram',author_handle:'teamone',published_at:'2026-08-10T00:00:00Z',relationship_type:'direct_tag',visibility_status:'excluded',engagement_total:10,reaction_count:8,comment_count:2},
 {id:'1',district_id:'district-a',platform:'instagram',author_handle:'TEAMONE',published_at:'2026-08-10T00:00:00Z',relationship_type:'direct_tag',visibility_status:'excluded',engagement_total:10},
 {id:'2',district_id:'district-a',platform:'facebook',author_handle:'teamone',published_at:'2026-08-09T00:00:00Z',relationship_type:'ambient',visibility_status:'active',engagement_total:99},
 {id:'3',district_id:'district-a',platform:'instagram',author_handle:'teamone-fans',published_at:'2026-08-08T00:00:00Z',relationship_type:'ambient',visibility_status:'active',engagement_total:88},
 {id:'4',district_id:'district-a',platform:'instagram',author_handle:' @TeamOne ',published_at:'2026-06-01T00:00:00Z',relationship_type:'direct_tag',visibility_status:'active',engagement_total:5,reaction_count:4,comment_count:1},
];
const preview=buildSocialAffiliatePreview({claim,threads,now:new Date('2026-08-12T00:00:00Z')});
assert.equal(preview.matchedPosts,2);
assert.equal(preview.modeledAffiliatePosts,2);
assert.equal(preview.engagementTotal,15);
assert.equal(preview.activePosts,1);
assert.equal(preview.excludedPosts,1);
assert.equal(preview.last30Days,1);
assert.equal(preview.last90Days,2);
assert.deepEqual(preview.relationships,{direct_tag:2});
assert.equal(preview.wouldChangeStoredRows,false);
assert.equal(preview.samples.length,2);
const empty=buildSocialAffiliatePreview({claim:{...claim,social_accounts:{...claim.social_accounts,handle:'no-history'}},threads,now:new Date('2026-08-12T00:00:00Z')});
assert.equal(empty.matchedPosts,0);
assert.equal(empty.latestPublishedAt,null);
console.log('Social affiliate attribution preview unit tests passed.');
