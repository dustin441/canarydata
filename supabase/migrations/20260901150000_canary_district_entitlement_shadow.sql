-- Additive Canary district lifecycle authority and shadow-mode read surfaces.
-- This migration does not seed entitlements and does not change customer access or collection behavior.

create table if not exists public.district_entitlements (
  district_id text primary key references public.districts(id) on update cascade on delete restrict,
  entitlement_type text not null check (entitlement_type in ('trial', 'paid', 'complimentary', 'legacy')),
  access_status text not null check (access_status in ('active', 'inactive_frozen', 'manual_hold', 'revoked')),
  starts_at timestamptz,
  ends_at timestamptz,
  trial_consumed_at timestamptz,
  onboarding_request_id uuid references public.onboarding_requests(id) on update cascade on delete set null,
  source text not null check (source in ('onboarding', 'stripe', 'operator', 'migration', 'legacy_review')),
  source_reference text,
  reason text,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (entitlement_type <> 'trial' or ends_at is not null),
  check (access_status not in ('manual_hold', 'revoked') or nullif(btrim(reason), '') is not null)
);

create table if not exists public.district_entitlement_events (
  id bigint generated always as identity primary key,
  district_id text not null references public.districts(id) on update cascade on delete restrict,
  event_type text not null check (event_type in ('created', 'updated')),
  previous_state jsonb,
  next_state jsonb not null,
  actor_user_id uuid,
  source text not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists district_entitlements_status_idx
  on public.district_entitlements (access_status, entitlement_type, ends_at);
create index if not exists district_entitlement_events_district_created_idx
  on public.district_entitlement_events (district_id, created_at desc, id desc);

create or replace function public.canary_prepare_district_entitlement_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(new.*) is distinct from row(old.*) then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists canary_prepare_district_entitlement_update on public.district_entitlements;
create trigger canary_prepare_district_entitlement_update
before update on public.district_entitlements
for each row execute function public.canary_prepare_district_entitlement_update();

create or replace function public.canary_record_district_entitlement_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.district_entitlement_events (
    district_id,
    event_type,
    previous_state,
    next_state,
    actor_user_id,
    source,
    reason
  ) values (
    new.district_id,
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    new.updated_by,
    new.source,
    new.reason
  );
  return new;
end;
$$;

drop trigger if exists canary_record_district_entitlement_event on public.district_entitlements;
create trigger canary_record_district_entitlement_event
after insert or update on public.district_entitlements
for each row execute function public.canary_record_district_entitlement_event();

create or replace function public.canary_reject_district_entitlement_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Canary district entitlement events are append-only';
end;
$$;

drop trigger if exists canary_reject_district_entitlement_event_mutation on public.district_entitlement_events;
create trigger canary_reject_district_entitlement_event_mutation
before update or delete on public.district_entitlement_events
for each row execute function public.canary_reject_district_entitlement_event_mutation();

alter table public.district_entitlements enable row level security;
alter table public.district_entitlement_events enable row level security;

revoke all on table public.district_entitlements from public, anon, authenticated;
revoke all on table public.district_entitlement_events from public, anon, authenticated;
grant select, insert, update, delete on table public.district_entitlements to service_role;
grant select, insert on table public.district_entitlement_events to service_role;
grant usage, select on sequence public.district_entitlement_events_id_seq to service_role;

create or replace view public.canary_effective_district_entitlements
with (security_invoker = true)
as
select
  entitlement.district_id,
  entitlement.entitlement_type,
  entitlement.access_status as recorded_access_status,
  case
    when entitlement.access_status = 'revoked' then 'revoked'
    when entitlement.access_status = 'manual_hold' then 'manual_hold'
    when entitlement.access_status = 'inactive_frozen' then 'inactive_frozen'
    when entitlement.ends_at is not null and entitlement.ends_at <= now() then 'inactive_frozen'
    else 'active'
  end as effective_access_status,
  entitlement.starts_at,
  entitlement.ends_at,
  entitlement.trial_consumed_at,
  entitlement.onboarding_request_id,
  entitlement.source,
  entitlement.source_reference,
  entitlement.reason,
  entitlement.version,
  entitlement.updated_at,
  entitlement.updated_by,
  (
    entitlement.access_status = 'active'
    and (entitlement.ends_at is null or entitlement.ends_at > now())
  ) as collection_allowed
from public.district_entitlements entitlement;

revoke all on table public.canary_effective_district_entitlements from public, anon, authenticated;
grant select on table public.canary_effective_district_entitlements to service_role;

create or replace function public.canary_strategic_priority_profile(p_district_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'district_id', p_district_id,
    'source', 'supabase.strategic_profiles/strategic_priorities',
    'profile', (
      select to_jsonb(profile)
      from (
        select
          strategic_profiles.district_id,
          strategic_profiles.source_confidence,
          strategic_profiles.mission,
          strategic_profiles.vision,
          strategic_profiles.values,
          strategic_profiles.source_urls,
          strategic_profiles.notes
        from public.strategic_profiles
        where strategic_profiles.district_id = p_district_id
        limit 1
      ) profile
    ),
    'priorities', coalesce((
      select jsonb_agg(to_jsonb(priority) order by priority.label)
      from (
        select
          strategic_priorities.label,
          strategic_priorities.description,
          strategic_priorities.aliases,
          strategic_priorities.confidence,
          strategic_priorities.source_urls
        from public.strategic_priorities
        where strategic_priorities.district_id = p_district_id
          and strategic_priorities.active = true
        order by strategic_priorities.label
      ) priority
    ), '[]'::jsonb),
    'lookup_errors', '[]'::jsonb
  );
$$;

revoke all on function public.canary_strategic_priority_profile(text) from public, anon, authenticated;
grant execute on function public.canary_strategic_priority_profile(text) to service_role;

comment on table public.district_entitlements is
  'Server-controlled district lifecycle authority. Additive shadow mode only until explicit cutover approval.';
comment on table public.district_entitlement_events is
  'Append-only audit history for district lifecycle transitions.';
comment on view public.canary_effective_district_entitlements is
  'Computed district lifecycle state. No collection path consumes this view until shadow discrepancies are resolved and cutover is approved.';
