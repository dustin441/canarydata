import assert from 'node:assert/strict';
import {
  facebookAccountInsightRequests,
  facebookContentInsightRequests,
  instagramAccountInsightRequests,
  instagramContentInsightRequests,
  normalizeMetaInsightBatch,
} from '../src/lib/meta-insights.mjs';

const observedAt='2026-08-14T22:00:00.000Z';
assert.equal(facebookAccountInsightRequests('page-1').length,3);
assert.equal(facebookContentInsightRequests('page-1_1').length,6);
assert.ok(instagramAccountInsightRequests('ig-1',{since:'2026-08-07',until:'2026-08-14'}).some((r)=>r.metricVariant==='total_value'));
assert.ok(instagramContentInsightRequests('ig-media-1',{mediaProductType:'REELS'}).some((r)=>r.providerMetricName==='shares'));

const rows=normalizeMetaInsightBatch({
 platform:'facebook',metricScope:'content',providerObjectId:'page-1_1',observedAt,
 requests:facebookContentInsightRequests('page-1_1').slice(0,3),
 results:[
  {ok:true,payload:{data:[{name:'post_media_view',period:'lifetime',values:[{value:494}]}]}},
  {ok:true,payload:{data:[{name:'post_total_media_view_unique',period:'lifetime',values:[{value:453}]}]}},
  {ok:true,payload:{data:[{name:'post_clicks',period:'lifetime',values:[{value:1}]}]}},
 ],
});
assert.equal(rows.length,3);
assert.equal(rows[0].normalized_metric_name,'views');
assert.equal(rows[0].metric_value,494);
assert.equal(rows[0].effective_at,'2026-08-14T00:00:00.000Z');
assert.equal(rows[1].normalized_metric_name,'unique_viewers');
assert.equal(rows[2].normalized_metric_name,'clicks');

const breakdown=normalizeMetaInsightBatch({
 platform:'facebook',metricScope:'content',providerObjectId:'page-1_1',observedAt,
 requests:[facebookContentInsightRequests('page-1_1').find((r)=>r.providerMetricName==='post_activity_by_action_type')],
 results:[{ok:true,payload:{data:[{name:'post_activity_by_action_type',period:'lifetime',values:[{value:{like:1,share:2}}]}]}}],
});
assert.deepEqual(breakdown[0].breakdown,{like:1,share:2});
assert.equal(breakdown[0].metric_value,null);

const unavailable=normalizeMetaInsightBatch({
 platform:'instagram',metricScope:'account',providerObjectId:'ig-1',observedAt,
 requests:[instagramAccountInsightRequests('ig-1',{since:'2026-08-07',until:'2026-08-14'})[0]],
 results:[{ok:true,payload:{data:[]}}],
});
assert.equal(unavailable[0].availability,'unavailable');
assert.equal(unavailable[0].metric_value,null);

const unsupported=normalizeMetaInsightBatch({
 platform:'instagram',metricScope:'content',providerObjectId:'ig-media-1',observedAt,
 requests:[instagramContentInsightRequests('ig-media-1',{mediaProductType:'REELS'})[0]],
 results:[{ok:false,status:400,error:{code:100,message:'metric not supported'}}],
});
assert.equal(unsupported[0].availability,'unsupported');
assert.equal(unsupported[0].provider_metadata.provider_error_code,'100');

const accountTotal=normalizeMetaInsightBatch({
 platform:'instagram',metricScope:'account',providerObjectId:'ig-1',observedAt,
 requests:[instagramAccountInsightRequests('ig-1',{since:'2026-08-07',until:'2026-08-14'}).find((r)=>r.providerMetricName==='views')],
 results:[{ok:true,payload:{data:[{name:'views',period:'day',total_value:{value:905}}]}}],
});
assert.equal(accountTotal[0].metric_value,905);
assert.equal(accountTotal[0].metric_variant,'total_value');
assert.equal(accountTotal[0].period_start_at,'2026-08-07T00:00:00.000Z');
assert.equal(accountTotal[0].period_end_at,'2026-08-14T00:00:00.000Z');

console.log('Meta Insights normalization tests passed.');
