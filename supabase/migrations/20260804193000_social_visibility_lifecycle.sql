-- Transactional Social visibility lifecycle and exclusion-preserving ingestion.
-- This migration intentionally leaves legacy RPCs, existing rows, and the visibility default unchanged.
-- SECURITY DEFINER callers using service_role must pass the authenticated reviewer's UUID as actor;
-- service_role itself is never accepted as an audit identity. Idempotent replays return the stored
-- historical result snapshot from the first completed request, not a fresh read of social_threads.

begin;

create table public.social_correction_requests (
  actor_user_id uuid not null,
  idempotency_key text not null,
  request_payload jsonb not null,
  result_row jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (actor_user_id, idempotency_key),
  constraint social_correction_requests_key_check
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  constraint social_correction_requests_completion_check
    check ((completed_at is null and result_row is null) or (completed_at is not null and result_row is not null))
);

alter table public.social_correction_requests enable row level security;
revoke all on table public.social_correction_requests from public, anon, authenticated, service_role;

create or replace function public.canary_apply_social_correction(
  p_actor_user_id uuid,
  p_expected_district_id text,
  p_social_thread_id uuid,
  p_action text,
  p_expected_version integer,
  p_idempotency_key text
)
returns public.social_threads
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  before_row public.social_threads%rowtype;
  after_row public.social_threads%rowtype;
  request_record public.social_correction_requests%rowtype;
  request_payload jsonb;
  inserted_claim_count integer := 0;
  new_batch_id uuid;
begin
  if p_actor_user_id is null then
    raise exception 'Actor is required';
  end if;
  perform public.canary_assert_social_reviewer(p_actor_user_id);

  if p_expected_district_id is null or btrim(p_expected_district_id) = '' then
    raise exception 'Expected district is required';
  end if;
  if p_social_thread_id is null then
    raise exception 'Social result is required';
  end if;
  if p_action is null or p_action not in ('exclude', 'restore') then
    raise exception 'Unsupported social correction action';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'Expected review version must be a non-negative integer';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) > 128
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' then
    raise exception 'Social correction idempotency key must be 8 to 128 URL-safe characters';
  end if;

  request_payload := jsonb_build_object(
    'expected_district_id', p_expected_district_id,
    'social_thread_id', p_social_thread_id,
    'action', p_action,
    'expected_version', p_expected_version
  );

  insert into public.social_correction_requests (
    actor_user_id, idempotency_key, request_payload
  ) values (
    p_actor_user_id, p_idempotency_key, request_payload
  )
  on conflict (actor_user_id, idempotency_key) do nothing;
  get diagnostics inserted_claim_count = row_count;

  select * into request_record
  from public.social_correction_requests
  where actor_user_id = p_actor_user_id
    and idempotency_key = p_idempotency_key
  for update;

  if request_record.request_payload is distinct from request_payload then
    raise exception 'Social correction idempotency key was already used for a different request';
  end if;
  if inserted_claim_count = 0 then
    if request_record.completed_at is null or request_record.result_row is null then
      raise exception 'Social correction idempotency claim is incomplete';
    end if;
    return jsonb_populate_record(null::public.social_threads, request_record.result_row);
  end if;

  select * into before_row
  from public.social_threads
  where id = p_social_thread_id
  for update;
  if not found then
    raise exception 'Social result not found';
  end if;
  if before_row.district_id <> p_expected_district_id then
    raise exception 'Social result district does not match expected district';
  end if;
  if before_row.review_version <> p_expected_version then
    raise exception 'Social result changed; refresh and try again';
  end if;

  if p_action = 'exclude' then
    if before_row.visibility_status not in ('review', 'approved', 'active') then
      raise exception 'Only review, approved, or active social results can be excluded';
    end if;
    update public.social_threads
    set visibility_status = 'excluded',
        review_version = review_version + 1,
        reviewed_at = now(),
        reviewed_by = p_actor_user_id
    where id = before_row.id
    returning * into after_row;
  else
    if before_row.visibility_status <> 'excluded' then
      raise exception 'Only excluded social results can be restored';
    end if;
    update public.social_threads
    set visibility_status = 'active',
        review_version = review_version + 1,
        reviewed_at = now(),
        reviewed_by = p_actor_user_id
    where id = before_row.id
    returning * into after_row;
  end if;

  insert into public.social_review_batches (
    district_id, action, actor_user_id, item_count, criteria
  ) values (
    before_row.district_id,
    p_action,
    p_actor_user_id,
    1,
    jsonb_build_object(
      'social_thread_id', before_row.id,
      'idempotency_key', p_idempotency_key
    )
  ) returning id into new_batch_id;

  insert into public.social_review_events (
    batch_id, district_id, social_thread_id, actor_user_id, action,
    before_state, after_state, resulting_version
  ) values (
    new_batch_id,
    before_row.district_id,
    before_row.id,
    p_actor_user_id,
    p_action,
    to_jsonb(before_row),
    to_jsonb(after_row),
    after_row.review_version
  );

  update public.social_correction_requests
  set result_row = to_jsonb(after_row), completed_at = now()
  where actor_user_id = p_actor_user_id
    and idempotency_key = p_idempotency_key;

  return after_row;
end;
$$;

create or replace function public.canary_ingest_social_thread(p_thread jsonb)
returns public.social_threads
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  incoming public.social_threads%rowtype;
  stored_row public.social_threads%rowtype;
begin
  if p_thread is null or jsonb_typeof(p_thread) <> 'object' then
    raise exception 'Social thread payload must be a JSON object';
  end if;
  if octet_length(p_thread::text) > 262144 then
    raise exception 'Social thread payload must be 262144 bytes or fewer';
  end if;

  incoming := jsonb_populate_record(null::public.social_threads, p_thread);

  if incoming.district_id is null or btrim(incoming.district_id) = '' then
    raise exception 'district_id is required';
  end if;
  if not exists (select 1 from public.districts where id = incoming.district_id) then
    raise exception 'Social thread district does not exist';
  end if;
  if incoming.provider is null or btrim(incoming.provider) = '' then
    raise exception 'provider is required';
  end if;
  if incoming.platform is null or incoming.platform not in ('facebook','instagram','youtube','x','threads','tiktok','linkedin') then
    raise exception 'Unsupported social platform';
  end if;
  if incoming.external_thread_id is null or btrim(incoming.external_thread_id) = '' then
    raise exception 'external_thread_id is required';
  end if;
  if incoming.canonical_url is null or btrim(incoming.canonical_url) = '' then
    raise exception 'canonical_url is required';
  end if;
  if incoming.relationship_type is null or incoming.relationship_type not in ('owned','direct_tag','direct_mention','ambient') then
    raise exception 'Unsupported social relationship_type';
  end if;
  if incoming.published_at is null then
    raise exception 'published_at is required';
  end if;
  if not isfinite(incoming.published_at)
     or (incoming.first_seen_at is not null and not isfinite(incoming.first_seen_at))
     or (incoming.last_seen_at is not null and not isfinite(incoming.last_seen_at)) then
    raise exception 'Social timestamps must be finite';
  end if;
  if coalesce(incoming.first_seen_at, now()) > coalesce(incoming.last_seen_at, now()) then
    raise exception 'first_seen_at must not be after last_seen_at';
  end if;
  if incoming.visibility_status is null or incoming.visibility_status not in ('review', 'active', 'excluded') then
    raise exception 'visibility_status must be review, active, or excluded';
  end if;
  if coalesce(incoming.comment_count, 0) < 0
     or coalesce(incoming.reply_count, 0) < 0
     or coalesce(incoming.reaction_count, 0) < 0
     or coalesce(incoming.share_count, 0) < 0
     or coalesce(incoming.view_count, 0) < 0
     or coalesce(incoming.engagement_total, 0) < 0 then
    raise exception 'Social metrics must be non-negative';
  end if;
  if incoming.identity_confidence is not null and (incoming.identity_confidence < 0 or incoming.identity_confidence > 1) then
    raise exception 'identity_confidence must be between zero and one';
  end if;
  if p_thread ? 'tags' and jsonb_typeof(p_thread->'tags') <> 'array'
     or p_thread ? 'strategic_alignment' and jsonb_typeof(p_thread->'strategic_alignment') <> 'array'
     or p_thread ? 'matched_terms' and jsonb_typeof(p_thread->'matched_terms') <> 'array'
     or p_thread ? 'provider_metadata' and jsonb_typeof(p_thread->'provider_metadata') <> 'object' then
    raise exception 'Social JSON collection fields have invalid types';
  end if;
  if incoming.social_account_id is not null and not exists (
    select 1 from public.social_accounts account
    where account.id = incoming.social_account_id
      and account.district_id = incoming.district_id
      and account.platform = incoming.platform
      and account.provider = btrim(incoming.provider)
  ) then
    raise exception 'Social account does not match the thread district, platform, and provider';
  end if;

  insert into public.social_threads (
    district_id,
    social_account_id,
    provider,
    platform,
    external_thread_id,
    canonical_url,
    relationship_type,
    author_name,
    author_handle,
    headline,
    body,
    summary,
    recommendation,
    published_at,
    first_seen_at,
    last_seen_at,
    comment_count,
    reply_count,
    reaction_count,
    share_count,
    view_count,
    engagement_total,
    sentiment,
    risk_level,
    canary_score,
    tags,
    strategic_alignment,
    matched_terms,
    match_reason,
    identity_confidence,
    visibility_status,
    reviewer_note,
    review_version,
    provider_metadata,
    reviewed_at,
    reviewed_by,
    created_at,
    updated_at
  ) values (
    incoming.district_id,
    incoming.social_account_id,
    btrim(incoming.provider),
    incoming.platform,
    btrim(incoming.external_thread_id),
    btrim(incoming.canonical_url),
    incoming.relationship_type,
    incoming.author_name,
    incoming.author_handle,
    incoming.headline,
    incoming.body,
    incoming.summary,
    incoming.recommendation,
    incoming.published_at,
    coalesce(incoming.first_seen_at, now()),
    coalesce(incoming.last_seen_at, now()),
    coalesce(incoming.comment_count, 0),
    coalesce(incoming.reply_count, 0),
    coalesce(incoming.reaction_count, 0),
    coalesce(incoming.share_count, 0),
    coalesce(incoming.view_count, 0),
    coalesce(incoming.engagement_total, 0),
    incoming.sentiment,
    incoming.risk_level,
    incoming.canary_score,
    coalesce(incoming.tags, '[]'::jsonb),
    coalesce(incoming.strategic_alignment, '[]'::jsonb),
    coalesce(incoming.matched_terms, '[]'::jsonb),
    incoming.match_reason,
    incoming.identity_confidence,
    incoming.visibility_status,
    null,
    0,
    coalesce(incoming.provider_metadata, '{}'::jsonb),
    null,
    null,
    now(),
    now()
  )
  on conflict (district_id, platform, external_thread_id) do update
  set social_account_id = coalesce(social_threads.social_account_id, excluded.social_account_id),
      canonical_url = excluded.canonical_url,
      author_name = excluded.author_name,
      author_handle = excluded.author_handle,
      headline = excluded.headline,
      body = excluded.body,
      summary = excluded.summary,
      recommendation = excluded.recommendation,
      published_at = excluded.published_at,
      last_seen_at = excluded.last_seen_at,
      comment_count = excluded.comment_count,
      reply_count = excluded.reply_count,
      reaction_count = excluded.reaction_count,
      share_count = excluded.share_count,
      view_count = excluded.view_count,
      engagement_total = excluded.engagement_total,
      sentiment = excluded.sentiment,
      risk_level = excluded.risk_level,
      canary_score = excluded.canary_score,
      tags = excluded.tags,
      strategic_alignment = excluded.strategic_alignment,
      matched_terms = excluded.matched_terms,
      match_reason = excluded.match_reason,
      identity_confidence = excluded.identity_confidence,
      provider_metadata = excluded.provider_metadata,
      updated_at = now()
  where social_threads.provider = excluded.provider
    and (
      social_threads.social_account_id is null
      or excluded.social_account_id is null
      or social_threads.social_account_id = excluded.social_account_id
    )
  returning * into stored_row;

  if not found then
    if exists (
      select 1 from public.social_threads current_row
      where current_row.district_id = incoming.district_id
        and current_row.platform = incoming.platform
        and current_row.external_thread_id = btrim(incoming.external_thread_id)
        and current_row.provider <> btrim(incoming.provider)
    ) then
      raise exception 'Social thread provider lineage is immutable';
    end if;
    raise exception 'Social account reassignment is not allowed';
  end if;

  return stored_row;
end;
$$;

revoke all on function public.canary_apply_social_correction(uuid, text, uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.canary_ingest_social_thread(jsonb) from public, anon, authenticated;
grant execute on function public.canary_apply_social_correction(uuid, text, uuid, text, integer, text) to service_role;
grant execute on function public.canary_ingest_social_thread(jsonb) to service_role;

commit;
