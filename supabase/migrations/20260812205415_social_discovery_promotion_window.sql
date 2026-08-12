-- Hotfix existing candidate-gate installations so approved promotions use the gate observation window.
-- The candidate payload may contain a provider observation timestamp older than Canary's staged first_seen_at.

begin;
select pg_advisory_xact_lock(hashtextextended('canary:social-discovery-promotion-window:20260812205415', 0));
set local lock_timeout = '10s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.social_discovery_candidates') is null
     or to_regclass('public.social_discovery_review_requests') is null
     or to_regclass('public.social_discovery_review_events') is null
     or to_regprocedure('public.canary_review_social_discovery(uuid,text,uuid,text,integer,text,text)') is null
     or to_regprocedure('public.canary_ingest_social_thread(jsonb)') is null then
    raise exception 'Installed Social discovery candidate gate is required';
  end if;
end $$;

create or replace function public.canary_review_social_discovery(
  p_actor_user_id uuid,
  p_expected_district_id text,
  p_candidate_id uuid,
  p_action text,
  p_expected_version integer,
  p_reviewer_note text,
  p_idempotency_key text
)
returns public.social_discovery_candidates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  before_row public.social_discovery_candidates%rowtype;
  after_row public.social_discovery_candidates%rowtype;
  request_row public.social_discovery_review_requests%rowtype;
  request_payload_value jsonb;
  inserted_claim_count integer := 0;
  promoted_row public.social_threads%rowtype;
  promotion_payload jsonb;
begin
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;
  perform public.canary_assert_social_reviewer(p_actor_user_id);
  if p_expected_district_id is null or btrim(p_expected_district_id) = '' then raise exception 'Expected district is required'; end if;
  if p_candidate_id is null then raise exception 'Candidate is required'; end if;
  if p_action not in ('approve','reject') then raise exception 'Unsupported Social discovery action'; end if;
  if p_expected_version is null or p_expected_version < 0 then raise exception 'Expected candidate version is required'; end if;
  if p_reviewer_note is not null and char_length(btrim(p_reviewer_note)) > 2000 then raise exception 'Reviewer note is too long'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' then raise exception 'Social discovery idempotency key must be 8 to 128 URL-safe characters'; end if;

  request_payload_value := jsonb_build_object(
    'expected_district_id', p_expected_district_id,
    'candidate_id', p_candidate_id,
    'action', p_action,
    'expected_version', p_expected_version,
    'reviewer_note', nullif(btrim(coalesce(p_reviewer_note, '')), '')
  );
  insert into public.social_discovery_review_requests (actor_user_id, idempotency_key, request_payload)
  values (p_actor_user_id, p_idempotency_key, request_payload_value)
  on conflict (actor_user_id, idempotency_key) do nothing;
  get diagnostics inserted_claim_count = row_count;

  select * into request_row from public.social_discovery_review_requests
  where actor_user_id = p_actor_user_id and idempotency_key = p_idempotency_key for update;
  if request_row.request_payload is distinct from request_payload_value then raise exception 'Social discovery idempotency key was already used for a different request'; end if;
  if inserted_claim_count = 0 then
    if request_row.completed_at is null or request_row.result_candidate is null then raise exception 'Social discovery idempotency claim is incomplete'; end if;
    return jsonb_populate_record(null::public.social_discovery_candidates, request_row.result_candidate);
  end if;

  select * into before_row from public.social_discovery_candidates where id = p_candidate_id for update;
  if not found then raise exception 'Social discovery candidate not found'; end if;
  if before_row.district_id <> p_expected_district_id then raise exception 'Social discovery candidate district does not match expected district'; end if;
  if before_row.status <> 'pending' then raise exception 'Only pending Social discovery candidates can be reviewed'; end if;
  if before_row.review_version <> p_expected_version then raise exception 'Social discovery candidate changed; refresh and try again'; end if;

  if p_action = 'approve' then
    promotion_payload := before_row.candidate_payload || jsonb_build_object(
      'visibility_status', 'active',
      'first_seen_at', before_row.first_seen_at,
      'last_seen_at', before_row.last_seen_at,
      'provider_metadata', coalesce(before_row.candidate_payload->'provider_metadata', '{}'::jsonb) || jsonb_build_object(
        'discovery_candidate_id', before_row.id,
        'discovery_approved_by', p_actor_user_id,
        'discovery_approved_at', now()
      )
    );
    promoted_row := public.canary_ingest_social_thread(promotion_payload);
    if promoted_row.visibility_status <> 'active' then
      raise exception 'Existing excluded Social result requires the separate audited restore action';
    end if;
    update public.social_discovery_candidates set
      status = 'approved', review_version = review_version + 1, reviewed_at = now(), reviewed_by = p_actor_user_id,
      reviewer_note = nullif(btrim(coalesce(p_reviewer_note, '')), ''), promoted_social_thread_id = promoted_row.id, updated_at = now()
    where id = before_row.id returning * into after_row;
  else
    update public.social_discovery_candidates set
      status = 'rejected', review_version = review_version + 1, reviewed_at = now(), reviewed_by = p_actor_user_id,
      reviewer_note = nullif(btrim(coalesce(p_reviewer_note, '')), ''), updated_at = now()
    where id = before_row.id returning * into after_row;
  end if;

  insert into public.social_discovery_review_events (
    candidate_id, district_id, actor_user_id, action, before_state, after_state, resulting_version
  ) values (
    before_row.id, before_row.district_id, p_actor_user_id, p_action, to_jsonb(before_row), to_jsonb(after_row), after_row.review_version
  );
  update public.social_discovery_review_requests set result_candidate = to_jsonb(after_row), completed_at = now()
  where actor_user_id = p_actor_user_id and idempotency_key = p_idempotency_key;
  return after_row;
end;
$$;


revoke all on function public.canary_review_social_discovery(uuid,text,uuid,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.canary_review_social_discovery(uuid,text,uuid,text,integer,text,text) to service_role;

commit;
