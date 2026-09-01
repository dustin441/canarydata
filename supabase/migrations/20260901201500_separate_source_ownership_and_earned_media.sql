begin;

alter table public.news_stories
  add column if not exists communications_earned boolean not null default false,
  add column if not exists communications_earned_updated_at timestamptz,
  add column if not exists communications_earned_updated_by uuid references auth.users(id);

alter table public.news_stories
  drop constraint if exists news_stories_communications_earned_external_check;
alter table public.news_stories
  add constraint news_stories_communications_earned_external_check
  check (
    not communications_earned
    or (
      is_earned_media is true
      and communications_earned_updated_at is not null
      and communications_earned_updated_by is not null
    )
  );

alter table public.story_correction_events
  drop constraint if exists story_correction_events_action_check;
alter table public.story_correction_events
  add constraint story_correction_events_action_check
  check (action in ('manual_add', 'exclude', 'restore', 'mark_earned', 'unmark_earned'));

create or replace function public.canary_guard_story_communications_earned_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(current_setting('canary.communications_earned_rpc', true), '') <> 'on' then
    raise exception 'Communications-earned state must be changed through the audited Canary RPC';
  end if;
  return new;
end;
$$;

create or replace function public.canary_guard_earned_source_reclassification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.communications_earned is true and new.is_earned_media is not true then
    raise exception 'Unmark Earned Media before reclassifying External coverage as Owned';
  end if;
  return new;
end;
$$;

drop trigger if exists news_stories_guard_communications_earned_insert on public.news_stories;
create trigger news_stories_guard_communications_earned_insert
before insert on public.news_stories
for each row
when (
  new.communications_earned is true
  or new.communications_earned_updated_at is not null
  or new.communications_earned_updated_by is not null
)
execute function public.canary_guard_story_communications_earned_write();

drop trigger if exists news_stories_guard_communications_earned_update on public.news_stories;
create trigger news_stories_guard_communications_earned_update
before update of communications_earned, communications_earned_updated_at, communications_earned_updated_by
on public.news_stories
for each row
when (
  old.communications_earned is distinct from new.communications_earned
  or old.communications_earned_updated_at is distinct from new.communications_earned_updated_at
  or old.communications_earned_updated_by is distinct from new.communications_earned_updated_by
)
execute function public.canary_guard_story_communications_earned_write();

drop trigger if exists news_stories_guard_earned_source_reclassification on public.news_stories;
create trigger news_stories_guard_earned_source_reclassification
before update of is_earned_media on public.news_stories
for each row
when (old.is_earned_media is distinct from new.is_earned_media)
execute function public.canary_guard_earned_source_reclassification();

create or replace function public.canary_set_story_communications_earned(
  p_actor_user_id uuid,
  p_story_id uuid,
  p_value boolean,
  p_expected_version integer
)
returns public.news_stories
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.news_stories;
  after_row public.news_stories;
  event_action text;
  event_reason text;
  actor_metadata jsonb;
begin
  select raw_app_meta_data into actor_metadata
  from auth.users
  where id = p_actor_user_id;
  if p_actor_user_id is null or actor_metadata is null then
    raise exception 'A valid Canary actor is required';
  end if;

  select * into before_row
  from public.news_stories
  where id = p_story_id
  for update;

  if not found then
    raise exception 'Story not found';
  end if;

  if coalesce(actor_metadata->>'role', '') = 'demo_reviewer'
     or (
       coalesce(actor_metadata->>'role', '') <> 'admin'
       and coalesce(actor_metadata->>'district_id', '') <> coalesce(before_row.district_id, '')
     ) then
    raise exception 'Actor does not have access to this district';
  end if;

  -- A retry after a successful response loss is idempotent even though its
  -- expected version is now stale.
  if before_row.communications_earned = p_value then
    return before_row;
  end if;

  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'A valid expected correction version is required';
  end if;
  if before_row.correction_version <> p_expected_version then
    raise exception 'Story changed before the Earned Media update could be saved';
  end if;

  if p_value and before_row.is_earned_media is not true then
    raise exception 'Only External coverage can be marked as Earned Media';
  end if;

  event_action := case when p_value then 'mark_earned' else 'unmark_earned' end;
  event_reason := case
    when p_value then 'Communicator marked External coverage as Earned Media'
    else 'Communicator removed the Earned Media mark'
  end;

  perform set_config('canary.communications_earned_rpc', 'on', true);
  update public.news_stories
  set communications_earned = p_value,
      communications_earned_updated_at = now(),
      communications_earned_updated_by = p_actor_user_id,
      correction_version = before_row.correction_version + 1
  where id = p_story_id
  returning * into after_row;
  perform set_config('canary.communications_earned_rpc', 'off', true);

  insert into public.story_correction_events (
    district_id,
    story_id,
    actor_user_id,
    action,
    reason,
    before_state,
    after_state,
    resulting_version
  ) values (
    after_row.district_id,
    after_row.id,
    p_actor_user_id,
    event_action,
    event_reason,
    to_jsonb(before_row),
    to_jsonb(after_row),
    after_row.correction_version
  );

  return after_row;
end;
$$;

revoke all on function public.canary_set_story_communications_earned(uuid, uuid, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.canary_set_story_communications_earned(uuid, uuid, boolean, integer)
  to service_role;

revoke insert, update, delete on public.story_correction_events from service_role;
grant select on public.story_correction_events to service_role;

comment on column public.news_stories.is_earned_media is
  'Internal compatibility field for automatic source ownership: true means External coverage; false means district-owned.';
comment on column public.news_stories.communications_earned is
  'Communicator attestation that External coverage was helped or secured by Communications; never inferred from publisher ownership.';
comment on function public.canary_set_story_communications_earned(uuid, uuid, boolean, integer) is
  'Tenant-scoped, versioned, idempotent Earned Media attestation with actor-controlled immutable audit history.';
comment on function public.canary_guard_earned_source_reclassification() is
  'Rejects External-to-Owned reclassification while an Earned attestation exists; Communications must unmark Earned first so history is explicit.';

commit;
