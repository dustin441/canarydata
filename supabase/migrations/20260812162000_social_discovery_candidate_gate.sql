-- Server-only pending-review boundary for provider-discovered Social content.
-- Keeps public.social_threads on the current active/excluded visibility contract.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('canary-social-discovery-candidate-gate', 0));

do $preflight$
declare
  current_default text;
  current_constraint text;
begin
  if to_regclass('public.social_threads') is null
     or to_regprocedure('public.canary_assert_social_reviewer(uuid)') is null
     or to_regprocedure('public.canary_ingest_social_thread(jsonb)') is null then
    raise exception 'Current Canary Social lifecycle objects are required';
  end if;
  if to_regclass('public.social_discovery_candidates') is not null
     or to_regclass('public.social_discovery_review_requests') is not null
     or to_regclass('public.social_discovery_review_events') is not null then
    raise exception 'Social discovery candidate gate objects already exist; verify before rerunning';
  end if;
  select pg_get_expr(d.adbin,d.adrelid) into current_default
  from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='public.social_threads'::regclass and a.attname='visibility_status';
  select pg_get_constraintdef(c.oid,true) into current_constraint
  from pg_constraint c where c.conrelid='public.social_threads'::regclass and c.conname='social_threads_visibility_status_check';
  if current_default not in ('''active''::text','''active''')
     or current_constraint is null
     or current_constraint like '%review%'
     or current_constraint like '%approved%'
     or current_constraint not like '%active%excluded%'
     or exists (select 1 from public.social_threads where visibility_status not in ('active','excluded')) then
    raise exception 'Current active/excluded Social visibility contract is required';
  end if;
end
$preflight$;

create table public.social_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete restrict,
  provider text not null check (btrim(provider) <> ''),
  platform text not null check (platform in ('facebook','instagram','youtube','x','threads','tiktok','linkedin')),
  external_thread_id text not null check (btrim(external_thread_id) <> ''),
  canonical_url text not null check (canonical_url ~ '^https?://'),
  relationship_type text not null check (relationship_type in ('owned','direct_tag','direct_mention','ambient')),
  candidate_payload jsonb not null check (jsonb_typeof(candidate_payload) = 'object'),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_version integer not null default 0 check (review_version >= 0),
  source_workflow_id text,
  source_execution_id text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  reviewer_note text check (reviewer_note is null or char_length(reviewer_note) <= 2000),
  promoted_social_thread_id uuid references public.social_threads(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (district_id, platform, external_thread_id),
  constraint social_discovery_candidates_review_state_check check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null and promoted_social_thread_id is null)
    or (status = 'approved' and reviewed_at is not null and reviewed_by is not null and promoted_social_thread_id is not null)
    or (status = 'rejected' and reviewed_at is not null and reviewed_by is not null and promoted_social_thread_id is null)
  )
);

create index social_discovery_candidates_queue_idx
  on public.social_discovery_candidates (district_id, status, last_seen_at desc, id);

create table public.social_discovery_review_requests (
  actor_user_id uuid not null,
  idempotency_key text not null,
  request_payload jsonb not null,
  result_candidate jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (actor_user_id, idempotency_key),
  constraint social_discovery_review_requests_key_check
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  constraint social_discovery_review_requests_completion_check
    check ((completed_at is null and result_candidate is null) or (completed_at is not null and result_candidate is not null))
);

create table public.social_discovery_review_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.social_discovery_candidates(id) on delete restrict,
  district_id text not null references public.districts(id) on delete restrict,
  actor_user_id uuid not null,
  action text not null check (action in ('approve','reject')),
  before_state jsonb not null,
  after_state jsonb not null,
  resulting_version integer not null check (resulting_version > 0),
  created_at timestamptz not null default now()
);

create function public.prevent_social_discovery_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Social discovery audit records are immutable';
end;
$$;

create function public.guard_social_discovery_review_request_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Social discovery review requests are immutable'; end if;
  if old.completed_at is not null
     or old.result_candidate is not null
     or new.actor_user_id is distinct from old.actor_user_id
     or new.idempotency_key is distinct from old.idempotency_key
     or new.request_payload is distinct from old.request_payload
     or new.created_at is distinct from old.created_at
     or new.completed_at is null
     or new.result_candidate is null then
    raise exception 'Social discovery review requests allow only one completion update';
  end if;
  return new;
end;
$$;

create trigger social_discovery_review_requests_immutable
before update or delete on public.social_discovery_review_requests
for each row execute function public.guard_social_discovery_review_request_mutation();

create trigger social_discovery_review_events_immutable
before update or delete on public.social_discovery_review_events
for each row execute function public.prevent_social_discovery_audit_mutation();

alter table public.social_discovery_candidates enable row level security;
alter table public.social_discovery_review_requests enable row level security;
alter table public.social_discovery_review_events enable row level security;

revoke all on table public.social_discovery_candidates from public, anon, authenticated, service_role;
revoke all on table public.social_discovery_review_requests from public, anon, authenticated, service_role;
revoke all on table public.social_discovery_review_events from public, anon, authenticated, service_role;
grant select on table public.social_discovery_candidates to service_role;
grant select on table public.social_discovery_review_events to service_role;

create function public.canary_stage_social_discovery(p_candidate jsonb)
returns public.social_discovery_candidates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  district_id_value text := btrim(p_candidate->>'district_id');
  provider_value text := btrim(p_candidate->>'provider');
  platform_value text := lower(btrim(p_candidate->>'platform'));
  external_id_value text := btrim(p_candidate->>'external_thread_id');
  canonical_url_value text := btrim(p_candidate->>'canonical_url');
  relationship_value text := lower(btrim(p_candidate->>'relationship_type'));
  workflow_id_value text := nullif(btrim(p_candidate->>'source_workflow_id'), '');
  execution_id_value text := nullif(btrim(p_candidate->>'source_execution_id'), '');
  sanitized_payload jsonb;
  stored_row public.social_discovery_candidates%rowtype;
begin
  if p_candidate is null or jsonb_typeof(p_candidate) <> 'object' then
    raise exception 'Social discovery candidate must be a JSON object';
  end if;
  if octet_length(p_candidate::text) > 262144 then
    raise exception 'Social discovery candidate must be 262144 bytes or fewer';
  end if;
  if district_id_value is null or district_id_value = ''
     or not exists (select 1 from public.districts where id = district_id_value) then
    raise exception 'Valid district_id is required';
  end if;
  if provider_value is null or provider_value = '' then raise exception 'provider is required'; end if;
  if platform_value not in ('facebook','instagram','youtube','x','threads','tiktok','linkedin') then raise exception 'Unsupported social platform'; end if;
  if external_id_value is null or external_id_value = '' then raise exception 'external_thread_id is required'; end if;
  if canonical_url_value is null or canonical_url_value !~ '^https?://' then raise exception 'Valid canonical_url is required'; end if;
  if relationship_value not in ('owned','direct_tag','direct_mention','ambient') then raise exception 'Unsupported social relationship_type'; end if;
  if nullif(btrim(p_candidate->>'published_at'), '') is null then raise exception 'published_at is required'; end if;
  perform (p_candidate->>'published_at')::timestamptz;
  if nullif(btrim(coalesce(p_candidate->>'body', p_candidate->>'headline', '')), '') is null then raise exception 'Social content is required'; end if;
  if p_candidate ? 'provider_metadata' and jsonb_typeof(p_candidate->'provider_metadata') <> 'object' then raise exception 'provider_metadata must be an object'; end if;

  sanitized_payload := (p_candidate - 'status' - 'visibility_status' - 'review_version' - 'reviewed_at' - 'reviewed_by' - 'reviewer_note'
    - 'promoted_social_thread_id' - 'source_workflow_id' - 'source_execution_id')
    || jsonb_build_object(
      'district_id', district_id_value,
      'provider', provider_value,
      'platform', platform_value,
      'external_thread_id', external_id_value,
      'canonical_url', canonical_url_value,
      'relationship_type', relationship_value
    );

  insert into public.social_discovery_candidates (
    district_id, provider, platform, external_thread_id, canonical_url, relationship_type,
    candidate_payload, source_workflow_id, source_execution_id
  ) values (
    district_id_value, provider_value, platform_value, external_id_value, canonical_url_value, relationship_value,
    sanitized_payload, workflow_id_value, execution_id_value
  )
  on conflict (district_id, platform, external_thread_id) do update
  set canonical_url = case when social_discovery_candidates.status = 'pending' then excluded.canonical_url else social_discovery_candidates.canonical_url end,
      relationship_type = case when social_discovery_candidates.status = 'pending' then excluded.relationship_type else social_discovery_candidates.relationship_type end,
      candidate_payload = case when social_discovery_candidates.status = 'pending' then excluded.candidate_payload else social_discovery_candidates.candidate_payload end,
      review_version = case when social_discovery_candidates.status = 'pending' then social_discovery_candidates.review_version + 1 else social_discovery_candidates.review_version end,
      source_workflow_id = coalesce(excluded.source_workflow_id, social_discovery_candidates.source_workflow_id),
      source_execution_id = coalesce(excluded.source_execution_id, social_discovery_candidates.source_execution_id),
      last_seen_at = now(),
      updated_at = now()
  where social_discovery_candidates.provider = excluded.provider
  returning * into stored_row;

  if not found then raise exception 'Social discovery provider lineage is immutable'; end if;
  return stored_row;
end;
$$;

create function public.canary_review_social_discovery(
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

revoke all on function public.canary_stage_social_discovery(jsonb) from public, anon, authenticated;
revoke all on function public.canary_review_social_discovery(uuid,text,uuid,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.canary_stage_social_discovery(jsonb) to service_role;
grant execute on function public.canary_review_social_discovery(uuid,text,uuid,text,integer,text,text) to service_role;

commit;
