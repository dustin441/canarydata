-- Harden Canary's additive district-entitlement shadow schema before any rows are seeded.
-- This migration keeps the feature shadow-only and does not change access or collection behavior.

alter table public.district_entitlements
  alter column source_reference set not null;

alter table public.district_entitlement_events
  add column if not exists source_reference text,
  add column if not exists actor_type text,
  add column if not exists actor_reference text;

update public.district_entitlement_events
set
  source_reference = coalesce(nullif(btrim(source_reference), ''), 'legacy-event:' || id::text),
  actor_type = coalesce(actor_type, case when actor_user_id is null then 'system' else 'user' end),
  actor_reference = coalesce(
    nullif(btrim(actor_reference), ''),
    actor_user_id::text,
    'legacy-event:' || id::text
  )
where source_reference is null
   or actor_type is null
   or actor_reference is null;

alter table public.district_entitlement_events
  alter column source_reference set not null,
  alter column actor_type set not null,
  alter column actor_reference set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'district_entitlements_source_reference_not_blank'
      and conrelid = 'public.district_entitlements'::regclass
  ) then
    alter table public.district_entitlements
      add constraint district_entitlements_source_reference_not_blank
      check (nullif(btrim(source_reference), '') is not null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'district_entitlements_operator_actor_required'
      and conrelid = 'public.district_entitlements'::regclass
  ) then
    alter table public.district_entitlements
      add constraint district_entitlements_operator_actor_required
      check (source <> 'operator' or updated_by is not null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'district_entitlements_updated_by_auth_user_fk'
      and conrelid = 'public.district_entitlements'::regclass
  ) then
    alter table public.district_entitlements
      add constraint district_entitlements_updated_by_auth_user_fk
      foreign key (updated_by) references auth.users(id) on update cascade on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'district_entitlement_events_actor_type_check'
      and conrelid = 'public.district_entitlement_events'::regclass
  ) then
    alter table public.district_entitlement_events
      add constraint district_entitlement_events_actor_type_check
      check (actor_type in ('user', 'system'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'district_entitlement_events_actor_reference_not_blank'
      and conrelid = 'public.district_entitlement_events'::regclass
  ) then
    alter table public.district_entitlement_events
      add constraint district_entitlement_events_actor_reference_not_blank
      check (nullif(btrim(actor_reference), '') is not null);
  end if;
end;
$$;

create or replace function public.canary_record_district_entitlement_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.district_entitlement_events (
    district_id,
    event_type,
    previous_state,
    next_state,
    actor_user_id,
    actor_type,
    actor_reference,
    source,
    source_reference,
    reason
  ) values (
    new.district_id,
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    new.updated_by,
    case when new.updated_by is null then 'system' else 'user' end,
    coalesce(new.updated_by::text, new.source || ':' || new.source_reference),
    new.source,
    new.source_reference,
    new.reason
  );
  return new;
end;
$$;

revoke all on function public.canary_record_district_entitlement_event()
  from public, anon, authenticated, service_role;

drop trigger if exists canary_record_district_entitlement_event on public.district_entitlements;
drop trigger if exists canary_record_district_entitlement_insert_event on public.district_entitlements;
drop trigger if exists canary_record_district_entitlement_update_event on public.district_entitlements;

create trigger canary_record_district_entitlement_insert_event
after insert on public.district_entitlements
for each row execute function public.canary_record_district_entitlement_event();

create trigger canary_record_district_entitlement_update_event
after update on public.district_entitlements
for each row
when (old.* is distinct from new.*)
execute function public.canary_record_district_entitlement_event();

create or replace function public.canary_reject_district_entitlement_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'Canary district entitlements must be frozen or revoked, not deleted';
end;
$$;

revoke all on function public.canary_reject_district_entitlement_delete()
  from public, anon, authenticated, service_role;

drop trigger if exists canary_reject_district_entitlement_delete on public.district_entitlements;
create trigger canary_reject_district_entitlement_delete
before delete on public.district_entitlements
for each row execute function public.canary_reject_district_entitlement_delete();

-- Shadow mode is read-only for runtime service credentials. Approved seeding and
-- later mutation cutover must use a separately reviewed, authenticated path.
revoke insert, update, delete on table public.district_entitlements from service_role;
revoke insert, update, delete on table public.district_entitlement_events from service_role;
revoke all on sequence public.district_entitlement_events_id_seq from service_role;
grant select on table public.district_entitlements to service_role;
grant select on table public.district_entitlement_events to service_role;

comment on table public.district_entitlements is
  'Server-controlled district lifecycle authority. Shadow-only and runtime read-only until approved classification and mutation cutover.';
comment on table public.district_entitlement_events is
  'Trigger-generated append-only district lifecycle history. Runtime roles cannot forge, update, or delete events.';
