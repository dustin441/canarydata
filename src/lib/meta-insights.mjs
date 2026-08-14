const DAY_MS=86_400_000;

const NORMALIZED={
 page_post_engagements:'engagements',page_media_view:'views',page_total_media_view_unique:'unique_viewers',
 post_media_view:'views',post_total_media_view_unique:'unique_viewers',post_clicks:'clicks',post_clicks_by_type:'click_breakdown',post_activity_by_action_type:'action_breakdown',post_reactions_by_type_total:'reaction_breakdown',
 views:'views',reach:'reach',likes:'likes',comments:'comments',shares:'shares',saved:'saves',total_interactions:'total_interactions',total_views:'views',total_likes:'likes',total_comments:'comments',reposts:'reposts',profile_views:'profile_views',website_clicks:'website_clicks',profile_links_taps:'profile_link_taps',accounts_engaged:'accounts_engaged',follower_count:'follower_change',follows_and_unfollows:'follows_and_unfollows',
};

function request(path,providerMetricName,normalizedMetricName,{metricVariant='default',period='lifetime',periodStartAt=null,periodEndAt=null,params={}}={}){
 return {path,providerMetricName,normalizedMetricName:normalizedMetricName||NORMALIZED[providerMetricName]||providerMetricName,metricVariant,period,periodStartAt,periodEndAt,params};
}

export function facebookAccountInsightRequests(pageId){
 return ['page_post_engagements','page_media_view','page_total_media_view_unique'].map((metric)=>request(`${pageId}/insights`,metric,null,{period:'day',params:{metric}}));
}
export function facebookContentInsightRequests(postId){
 return ['post_media_view','post_total_media_view_unique','post_clicks','post_clicks_by_type','post_activity_by_action_type','post_reactions_by_type_total'].map((metric)=>request(`${postId}/insights`,metric,null,{params:{metric}}));
}
export function instagramAccountInsightRequests(accountId,{since,until}){
 const start=new Date(`${since}T00:00:00.000Z`).toISOString(); const end=new Date(`${until}T00:00:00.000Z`).toISOString();
 const common={period:'day',periodStartAt:start,periodEndAt:end};
 return [
  ...['reach','follower_count','follows_and_unfollows'].map((metric)=>request(`${accountId}/insights`,metric,null,{...common,metricVariant:'time_series',params:{metric,period:'day',since,until}})),
  ...['views','profile_views','website_clicks','profile_links_taps','accounts_engaged','total_interactions'].map((metric)=>request(`${accountId}/insights`,metric,null,{...common,metricVariant:'total_value',params:{metric,period:'day',metric_type:'total_value',since,until}})),
 ];
}
export function instagramContentInsightRequests(mediaId,{mediaProductType}={}){
 const metrics=['views','reach','likes','comments','shares','saved','total_interactions','total_views','total_likes','total_comments','reposts'];
 return metrics.map((metric)=>request(`${mediaId}/insights`,metric,null,{metricVariant:String(mediaProductType||'media').toLowerCase(),params:{metric}}));
}

function dayStart(value){const d=new Date(value); return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())).toISOString();}
function sourceScope(name){return name.startsWith('total_')||name.includes('_total')||['likes','comments','shares','saved','reposts','total_interactions'].includes(name)?'total':'unknown';}
function errorAvailability(result){return String(result?.error?.code||'')==='100'?'unsupported':'error';}
function snapshotBase({platform,metricScope,providerObjectId,observedAt,request:spec,name,period,effectiveAt}){
 return {metric_scope:metricScope,provider_object_id:String(providerObjectId),provider_metric_name:name||spec.providerMetricName,normalized_metric_name:spec.normalizedMetricName,metric_variant:spec.metricVariant,period:period||spec.period,period_start_at:spec.periodStartAt,period_end_at:spec.periodEndAt,source_scope:sourceScope(name||spec.providerMetricName),availability:'available',metric_value:null,breakdown:{},effective_at:effectiveAt,observed_at:new Date(observedAt).toISOString(),provider_metadata:{platform,source:'meta_graph_insights'}};
}
function unavailable(args,result,availability='unavailable'){
 const row=snapshotBase({...args,effectiveAt:args.request.periodEndAt||dayStart(args.observedAt)}); row.availability=availability;
 if(result?.error){row.provider_metadata.provider_error_code=String(result.error.code||'META_INSIGHTS_ERROR');row.provider_metadata.provider_error_message=String(result.error.message||'Meta Insights request failed.').slice(0,300);}
 return row;
}
function setValue(row,value){
 if(typeof value==='number'&&Number.isFinite(value)&&value>=0) row.metric_value=value;
 else if(value&&typeof value==='object'&&!Array.isArray(value)){row.breakdown=value; if(Object.keys(value).length===0) row.metric_value=0;}
 else {row.availability='unavailable';}
 return row;
}
export function normalizeMetaInsightBatch({platform,metricScope,providerObjectId,observedAt,requests,results}){
 const output=[];
 requests.forEach((spec,index)=>{
  const result=results[index];
  const args={platform,metricScope,providerObjectId,observedAt,request:spec};
  if(!result?.ok){output.push(unavailable(args,result,errorAvailability(result)));return;}
  const data=Array.isArray(result.payload?.data)?result.payload.data:[];
  if(!data.length){output.push(unavailable(args,result));return;}
  for(const metric of data){
   if(metric?.total_value){const row=snapshotBase({...args,name:metric.name,period:metric.period,effectiveAt:spec.periodEndAt||dayStart(observedAt)});output.push(setValue(row,metric.total_value.value));continue;}
   const values=Array.isArray(metric?.values)?metric.values:[];
   if(!values.length){output.push(unavailable({...args,request:{...spec,period:metric?.period||spec.period}},result));continue;}
   for(const point of values){const effectiveAt=point?.end_time?new Date(point.end_time).toISOString():spec.periodEndAt||dayStart(observedAt);const row=snapshotBase({...args,name:metric.name,period:metric.period,effectiveAt});output.push(setValue(row,point?.value));}
  }
 });
 return output;
}

export function sevenDayInsightWindow(now=new Date()){
 const end=dayStart(now); const start=new Date(new Date(end).getTime()-7*DAY_MS).toISOString();
 return {since:start.slice(0,10),until:end.slice(0,10)};
}
