-- READ ONLY. Capture immediately before rollback while every Social writer remains paused.
-- Set this to the validated visibility-backup watermark before running.
-- set canary.social_backup_watermark = '2026-08-05T11:56:45.637963Z';
begin transaction isolation level repeatable read read only;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $guard$
begin
  if nullif(current_setting('canary.social_backup_watermark', true), '') is null then
    raise exception 'Set canary.social_backup_watermark to the validated visibility backup watermark';
  end if;
  if to_regclass('public.social_correction_requests') is null
     or to_regclass('public.social_review_batches') is null
     or to_regclass('public.social_review_events') is null then
    raise exception 'Complete Task 4 evidence and audit tables are required';
  end if;
end
$guard$;

with settings as (
  select current_setting('canary.social_backup_watermark')::timestamptz watermark
), correction_rows as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'actorUserId', r.actor_user_id::text,
    'idempotencyKey', r.idempotency_key,
    'requestPayload', r.request_payload,
    'resultRow', r.result_row,
    'createdAt', to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'completedAt', case when r.completed_at is null then null else to_char(r.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'requestPayloadCanonical', r.request_payload::text,
    'resultRowCanonical', case when r.result_row is null then null else r.result_row::text end,
    'retainedRow', content.value,
    'currentChecksumSha256', encode(digest(convert_to(concat_ws('|',
      octet_length(r.actor_user_id::text)::text || ':' || r.actor_user_id::text,
      octet_length(r.idempotency_key)::text || ':' || r.idempotency_key,
      octet_length(r.request_payload::text)::text || ':' || r.request_payload::text,
      case when r.result_row is null then '6:<NULL>' else octet_length(r.result_row::text)::text || ':' || r.result_row::text end,
      octet_length(to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text || ':' || to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      case when r.completed_at is null then '6:<NULL>' else octet_length(to_char(r.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text || ':' || to_char(r.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end
    ), 'UTF8'), 'sha256'), 'hex'),
    'auditEventIds', coalesce((
      select jsonb_agg(e.id::text order by e.id)
      from public.social_review_events e
      join public.social_review_batches b on b.id=e.batch_id
      where e.actor_user_id=r.actor_user_id
        and e.social_thread_id=(r.request_payload->>'social_thread_id')::uuid
        and b.criteria->>'idempotency_key'=r.idempotency_key
    ), '[]'::jsonb),
    'auditBatchIds', coalesce((
      select jsonb_agg(distinct b.id::text order by b.id::text)
      from public.social_review_events e
      join public.social_review_batches b on b.id=e.batch_id
      where e.actor_user_id=r.actor_user_id
        and e.social_thread_id=(r.request_payload->>'social_thread_id')::uuid
        and b.criteria->>'idempotency_key'=r.idempotency_key
    ), '[]'::jsonb)
  ) order by r.actor_user_id, r.idempotency_key), '[]'::jsonb) rows
  from public.social_correction_requests r
  cross join lateral (select jsonb_build_object(
    'actor_user_id', r.actor_user_id::text,
    'idempotency_key', r.idempotency_key,
    'request_payload', r.request_payload,
    'result_row', r.result_row,
    'created_at', to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'completed_at', case when r.completed_at is null then null else to_char(r.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end
  ) value) content
), post_rows as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id::text,
    'tenant', t.district_id,
    'sourceIdentity', jsonb_build_object(
      'district_id', t.district_id, 'provider', t.provider, 'platform', t.platform,
      'external_thread_id', t.external_thread_id
    ),
    'idempotencyKey', 'rollback-replay:' || t.id::text,
    'row', to_jsonb(t),
    'rowCanonicalJson', to_jsonb(t)::text,
    'currentChecksumSha256', encode(digest(convert_to(to_jsonb(t)::text, 'UTF8'), 'sha256'), 'hex'),
    'auditEventIds', coalesce((select jsonb_agg(e.id::text order by e.id) from public.social_review_events e where e.social_thread_id=t.id), '[]'::jsonb),
    'auditBatchIds', coalesce((select jsonb_agg(distinct e.batch_id::text order by e.batch_id::text) from public.social_review_events e where e.social_thread_id=t.id), '[]'::jsonb),
    'disposition', 'replay'
  ) order by t.id), '[]'::jsonb) rows
  from public.social_threads t, settings s where t.created_at > s.watermark
), audit_counts as (
  select jsonb_build_object(
    'batchCount', (select count(*) from public.social_review_batches),
    'eventCount', (select count(*) from public.social_review_events),
    'linkageChecksumSha256', encode(digest(convert_to(coalesce((select string_agg(e.id::text || ':' || e.batch_id::text || ':' || e.social_thread_id::text, E'\n' order by e.id) from public.social_review_events e), ''), 'UTF8'), 'sha256'), 'hex')
  ) value
)
select jsonb_build_object(
  'watermark', to_char(settings.watermark at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'capturedAt', to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'correctionRequests', correction_rows.rows,
  'postWatermarkRows', post_rows.rows,
  'audit', audit_counts.value
) as social_rollback_evidence
from settings, correction_rows, post_rows, audit_counts;
rollback;
