import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enrichSocialThreadsWithNativeMetrics, nativeSocialMetricWindowLabel, summarizeOwnedSocialAccountMetrics } from '../src/lib/socialMetrics.mjs';
import { buildSocialResults } from '../src/lib/social.mjs';
import { socialReportComparableInteractionTotal, socialReportInteractionTotal } from '../src/lib/socialReport.mjs';

const threadFacebook={id:'thread-fb',district_id:'district-1',platform:'facebook',comment_count:0,reply_count:5,reaction_count:0,share_count:0,view_count:0,provider_metadata:{metric_availability:{comments:false,reactions:false,shares:false,views:false}}};
const threadInstagram={id:'thread-ig',district_id:'district-1',platform:'instagram',comment_count:0,reaction_count:0,share_count:0,view_count:0,provider_metadata:{metric_availability:{comments:true,reactions:true,shares:false,views:false}}};
const base={district_id:'district-1',provider:'meta',metric_scope:'content',metric_variant:'default',period:'lifetime',period_start_at:null,period_end_at:null,availability:'available',breakdown:{},source_scope:'unknown',observed_at:'2026-08-14T12:00:00Z'};
const contentRows=[
 {...base,observed_at:'2026-08-13T12:00:00Z',social_thread_id:'thread-fb',platform:'facebook',provider_metric_name:'post_media_view',normalized_metric_name:'views',metric_value:100,effective_at:'2026-08-13T00:00:00Z'},
 {...base,social_thread_id:'thread-fb',platform:'facebook',provider_metric_name:'post_media_view',normalized_metric_name:'views',metric_value:200,effective_at:'2026-08-14T00:00:00Z'},
 {...base,social_thread_id:'thread-fb',platform:'facebook',provider_metric_name:'post_total_media_view_unique',normalized_metric_name:'unique_viewers',metric_value:180,source_scope:'total',effective_at:'2026-08-14T00:00:00Z'},
 {...base,social_thread_id:'thread-fb',platform:'facebook',provider_metric_name:'post_clicks',normalized_metric_name:'clicks',metric_value:5,effective_at:'2026-08-14T00:00:00Z'},
 {...base,social_thread_id:'thread-fb',platform:'facebook',provider_metric_name:'post_reactions_by_type_total',normalized_metric_name:'reaction_breakdown',metric_value:null,breakdown:{like:6,love:1},source_scope:'total',effective_at:'2026-08-14T00:00:00Z'},
 {...base,social_thread_id:'thread-fb',platform:'facebook',provider_metric_name:'post_activity_by_action_type',normalized_metric_name:'action_breakdown',metric_value:null,breakdown:{comment:2,share:1},effective_at:'2026-08-14T00:00:00Z'},
 {...base,social_thread_id:'thread-ig',platform:'instagram',provider_metric_name:'views',normalized_metric_name:'views',metric_value:100,effective_at:'2026-08-14T00:00:00Z'},
 {...base,social_thread_id:'thread-ig',platform:'instagram',provider_metric_name:'total_views',normalized_metric_name:'views',metric_value:120,source_scope:'total',effective_at:'2026-08-14T00:00:00Z'},
 {...base,social_thread_id:'thread-ig',platform:'instagram',provider_metric_name:'likes',normalized_metric_name:'likes',metric_value:4,effective_at:'2026-08-14T00:00:00Z'},
 {...base,social_thread_id:'thread-ig',platform:'instagram',provider_metric_name:'comments',normalized_metric_name:'comments',metric_value:1,effective_at:'2026-08-14T00:00:00Z'},
 {...base,social_thread_id:'thread-ig',platform:'instagram',provider_metric_name:'shares',normalized_metric_name:'shares',metric_value:2,effective_at:'2026-08-14T00:00:00Z'},
 {...base,social_thread_id:'thread-ig',platform:'instagram',provider_metric_name:'saved',normalized_metric_name:'saves',metric_value:3,effective_at:'2026-08-14T00:00:00Z'},
 {...base,social_thread_id:'thread-ig',platform:'instagram',provider_metric_name:'reach',normalized_metric_name:'reach',metric_value:80,effective_at:'2026-08-14T00:00:00Z'},
];
const enriched=enrichSocialThreadsWithNativeMetrics([threadFacebook,threadInstagram],contentRows);
assert.equal(enriched[0].view_count,200);
assert.equal(enriched[0].reaction_count,7);
assert.equal(enriched[0].comment_count,2);
assert.equal(enriched[0].share_count,1);
assert.equal(enriched[0].reply_count,0,'native comment totals must not be combined with legacy reply counts');
assert.equal(enriched[0].engagement_total,10,'native interactions must exclude stale legacy replies');
assert.deepEqual(enriched[0].provider_metadata.metric_availability,{comments:true,reactions:true,shares:true,views:true});
assert.equal(enriched[0].provider_metadata.native_metrics.uniqueViewers.value,180);
assert.equal(enriched[0].provider_metadata.native_metrics.clicks.value,5);
assert.equal(enriched[0].provider_metadata.native_metrics.views.sourceScope,'unknown');
assert.equal(enriched[1].view_count,100,'Instagram provider variants must not be added or prefer total_views over views');
assert.equal(enriched[1].reaction_count,4);
assert.equal(enriched[1].comment_count,1);
assert.equal(enriched[1].share_count,2);
assert.equal(enriched[1].provider_metadata.native_metrics.saves.value,3);
assert.equal(enriched[1].provider_metadata.native_metrics.uniqueViewers.value,80);
const serializedEnriched=JSON.stringify(enriched);
assert.doesNotMatch(serializedEnriched,/provider_account_link_id|provider_object_id|\"breakdown\"/,'enriched client records must not contain raw snapshot identifiers or breakdown payloads');
assert.equal(enriched[0].provider_metadata.native_metrics.views.providerMetricName,'post_media_view','raw provider metric names must remain visible for provenance');
const historical=enrichSocialThreadsWithNativeMetrics([threadFacebook],contentRows,{asOf:'2026-08-13T23:59:59Z'});
assert.equal(historical[0].view_count,100);
const staleThread={...threadFacebook,view_count:999,provider_metadata:{metric_availability:{comments:false,reactions:false,shares:false,views:true}}};
const unavailableLatest={...contentRows[1],availability:'unavailable',metric_value:null,effective_at:'2026-08-15T00:00:00Z',observed_at:'2026-08-15T12:00:00Z'};
const unavailableActionLatest={...contentRows[5],availability:'unavailable',metric_value:null,breakdown:{},effective_at:'2026-08-15T00:00:00Z',observed_at:'2026-08-15T12:00:00Z'};
const unavailableEnriched=enrichSocialThreadsWithNativeMetrics([staleThread],[...contentRows,unavailableLatest,unavailableActionLatest]);
assert.equal(unavailableEnriched[0].provider_metadata.metric_availability.views,true,'unavailable native snapshots must preserve existing canonical availability');
assert.equal(unavailableEnriched[0].view_count,999,'unavailable native snapshots must not overwrite an existing canonical counter with zero');
assert.equal(unavailableEnriched[0].provider_metadata.native_metrics.views.availability,'unavailable');
assert.equal(unavailableEnriched[0].reply_count,5,'unavailable native comments must not clear existing replies');
const partialNativeThread={...threadFacebook,comment_count:9,reply_count:1,reaction_count:20,share_count:4,engagement_total:34,provider_metadata:{metric_availability:{comments:true,reactions:true,shares:true,views:false}}};
const partialAction={...contentRows[5],availability:'unavailable',metric_value:null,breakdown:{},effective_at:'2026-08-15T00:00:00Z',observed_at:'2026-08-15T12:00:00Z'};
const partialEnriched=enrichSocialThreadsWithNativeMetrics([partialNativeThread],[contentRows[4],partialAction]);
assert.equal(partialEnriched[0].reaction_count,7);
assert.equal(partialEnriched[0].comment_count,9);
assert.equal(partialEnriched[0].share_count,4);
assert.equal(partialEnriched[0].engagement_total,null,'partial native coverage must not create a mixed-source engagement total');
assert.equal(partialEnriched[0].provider_metadata.native_interaction_coverage,'partial');
const [partialResult]=buildSocialResults(partialEnriched);
assert.equal(socialReportInteractionTotal(partialResult),7,'reported ranking totals must use only available native interaction components');
assert.equal(socialReportComparableInteractionTotal(partialResult),null,'partial native coverage must not enter comparable aggregates');
assert.equal(partialResult.hasComparableInteractionData,false);

const accountBase={district_id:'district-1',provider_account_link_id:'link-default',account_identity:{name:'EIC Test',handle:'eictest',profileUrl:'https://example.test/eictest'},provider:'meta',metric_scope:'account',social_thread_id:null,availability:'available',breakdown:{},source_scope:'unknown',observed_at:'2026-08-14T12:00:00Z'};
const accountRows=[
 {...accountBase,platform:'facebook',provider_metric_name:'page_media_view',normalized_metric_name:'views',metric_variant:'default',period:'days_28',metric_value:192454,effective_at:'2026-08-13T07:00:00Z'},
 {...accountBase,platform:'facebook',provider_metric_name:'page_total_media_view_unique',normalized_metric_name:'unique_viewers',metric_variant:'default',period:'days_28',metric_value:74795,source_scope:'total',effective_at:'2026-08-13T07:00:00Z'},
 {...accountBase,platform:'facebook',provider_metric_name:'page_post_engagements',normalized_metric_name:'engagements',metric_variant:'default',period:'days_28',metric_value:2251,effective_at:'2026-08-13T07:00:00Z'},
 {...accountBase,platform:'instagram',provider_metric_name:'views',normalized_metric_name:'views',metric_variant:'total_value',period:'day',period_start_at:'2026-08-07T00:00:00Z',period_end_at:'2026-08-14T00:00:00Z',metric_value:1311,effective_at:'2026-08-14T00:00:00Z'},
 {...accountBase,platform:'instagram',provider_metric_name:'reach',normalized_metric_name:'reach',metric_variant:'time_series',period:'day',period_start_at:'2026-08-07T00:00:00Z',period_end_at:'2026-08-14T00:00:00Z',metric_value:171,effective_at:'2026-08-13T07:00:00Z'},
 {...accountBase,platform:'instagram',provider_metric_name:'total_interactions',normalized_metric_name:'total_interactions',metric_variant:'total_value',period:'day',period_start_at:'2026-08-07T00:00:00Z',period_end_at:'2026-08-14T00:00:00Z',metric_value:11,source_scope:'total',effective_at:'2026-08-14T00:00:00Z'},
 {...accountBase,platform:'instagram',provider_metric_name:'profile_views',normalized_metric_name:'profile_views',metric_variant:'total_value',period:'day',period_start_at:'2026-08-07T00:00:00Z',period_end_at:'2026-08-14T00:00:00Z',metric_value:7,effective_at:'2026-08-14T00:00:00Z'},
 {...accountBase,platform:'instagram',provider_metric_name:'profile_links_taps',normalized_metric_name:'profile_link_taps',metric_variant:'total_value',period:'day',period_start_at:'2026-08-07T00:00:00Z',period_end_at:'2026-08-14T00:00:00Z',metric_value:2,effective_at:'2026-08-14T00:00:00Z'},
 {...accountBase,platform:'instagram',provider_metric_name:'follows_and_unfollows',normalized_metric_name:'follows_and_unfollows',metric_variant:'total_value',period:'day',period_start_at:'2026-08-07T00:00:00Z',period_end_at:'2026-08-14T00:00:00Z',metric_value:null,breakdown:{breakdowns:[{dimension_keys:['follow_type'],results:[{dimension_values:['FOLLOWER'],value:4},{dimension_values:['NON_FOLLOWER'],value:1}]}]},effective_at:'2026-08-14T00:00:00Z'},
];
const accountSummary=summarizeOwnedSocialAccountMetrics(accountRows);
assert.equal(accountSummary.platforms.facebook.views.value,192454);
assert.equal(accountSummary.platforms.facebook.uniqueViewers.value,74795);
assert.equal(accountSummary.platforms.facebook.windowLabel,'28 days ending Aug 13, 2026');
const dailyFacebook=summarizeOwnedSocialAccountMetrics(accountRows.filter((row)=>row.platform!=='facebook').concat(accountRows.filter((row)=>row.platform==='facebook').map((row)=>({...row,period:'day'}))));
assert.equal(dailyFacebook.platforms.facebook.views.value,192454,'daily Facebook account snapshots must remain reportable');
assert.equal(dailyFacebook.platforms.facebook.windowLabel,'Day ending Aug 13, 2026');
assert.equal(accountSummary.platforms.instagram.views.value,1311);
assert.equal(accountSummary.platforms.instagram.reach.value,171);
assert.equal(accountSummary.platforms.instagram.reach.metricVariant,'time_series');
assert.equal(nativeSocialMetricWindowLabel(accountSummary.platforms.instagram.reach),'Daily value ending Aug 13, 2026','rendered metric-window output must preserve Instagram time-series semantics');
assert.equal(accountSummary.platforms.instagram.netFollowerChange.value,3);
assert.equal(accountSummary.platforms.instagram.windowLabel,'7 days ending Aug 14, 2026');
assert.equal(accountSummary.combinedReachOrViewers,null,'cross-platform audiences must never be summed');
assert.equal(summarizeOwnedSocialAccountMetrics([{...accountRows[0],period_start_at:null,period_end_at:null}]).platforms.facebook.windowLabel,'28 days ending Aug 13, 2026');
const decliningFollows=summarizeOwnedSocialAccountMetrics(accountRows.map((row)=>row.provider_metric_name==='follows_and_unfollows'?{...row,breakdown:{breakdowns:[{dimension_keys:['follow_type'],results:[{dimension_values:['FOLLOWER'],value:1},{dimension_values:['NON_FOLLOWER'],value:4}]}]}}:row));
assert.equal(decliningFollows.platforms.instagram.netFollowerChange.value,-3,'net follower declines must remain signed');
const profileOnly=summarizeOwnedSocialAccountMetrics(accountRows.filter((row)=>row.platform!=='instagram'||row.provider_metric_name==='profile_views'));
assert.equal(profileOnly.platforms.instagram.profileViews.value,7,'available account metrics must render even when views are absent');
const variantCollision=summarizeOwnedSocialAccountMetrics([...accountRows,{...accountRows[3],metric_variant:'time_series',metric_value:999,effective_at:'2026-08-15T00:00:00Z',observed_at:'2026-08-15T12:00:00Z'}]);
assert.equal(variantCollision.platforms.instagram.views.value,1311,'account summaries must select the intended total_value variant');
const linkA=accountRows.filter((row)=>row.platform==='facebook').map((row)=>({...row,provider_account_link_id:'link-a',account_identity:{name:'Facebook A',handle:'facebooka'}}));
const linkB={...accountRows[0],provider_account_link_id:'link-b',account_identity:{name:'Facebook B',handle:'facebookb'},metric_value:42,effective_at:'2026-08-15T00:00:00Z',observed_at:'2026-08-15T12:00:00Z'};
const reconnectSummary=summarizeOwnedSocialAccountMetrics([...linkA,linkB]);
assert.equal(reconnectSummary.accounts.length,2,'each active authorized account must retain its own row');
assert.deepEqual(reconnectSummary.accounts.map((account)=>[account.accountName,account.views.value]),[['Facebook A',192454],['Facebook B',42]]);
assert.equal(reconnectSummary.platforms.facebook,undefined,'multiple accounts on one platform must not collapse into an anonymous platform summary');
assert.equal(reconnectSummary.accounts[1].uniqueViewers,null,'account metrics from different provider links must not be mixed');

const dataSource=readFileSync(new URL('../src/lib/data.js',import.meta.url),'utf8');
const snapshotQuerySource=dataSource.slice(dataSource.indexOf('export async function getSocialMetricSnapshots'),dataSource.indexOf('export async function readAllSocialReviewEvents'));
assert.match(snapshotQuerySource,/if \(districtId\) query = query\.eq\('district_id', districtId\)/,'snapshot reads must be district scoped');
assert.match(snapshotQuerySource,/\.range\(from, from \+ SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE - 1\)/,'snapshot reads must paginate deterministically');
assert.match(snapshotQuerySource,/\.eq\('provider', 'meta'\)\.eq\('active', true\)/,'dashboard snapshots must be limited to active Meta account links');
assert.match(snapshotQuerySource,/\.in\('provider_account_link_id', linkBatch\)/,'snapshot reads must bind rows to active provider links');
assert.match(snapshotQuerySource,/\.from\('canary_latest_social_metric_snapshots'\)/,'dashboard reads must use the server-side latest-snapshot projection rather than full history');
assert.match(snapshotQuerySource,/social_provider_assets/,'account identity must be loaded for distinct account rows');
assert.doesNotMatch(snapshotQuerySource,/\.from\('social_provider_metric_snapshots'\)/,'dashboard must not paginate the unbounded snapshot history table');

console.log('Native Social reporting metric tests passed.');
