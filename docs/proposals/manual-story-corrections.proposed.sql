-- APPLIED WITH USER APPROVAL ON 2026-07-17. Retained as the canonical migration record.
-- A backup and canonical-URL collision report were created before the canonical backfill.
-- Assumes public.news_stories.id is uuid and district_id is text (verified 2026-07-17).

begin;

alter table public.news_stories
  add column if not exists canonical_url text,
  add column if not exists visibility_status text not null default 'active',
  add column if not exists manual_override boolean not null default false,
  add column if not exists correction_version integer not null default 0;

alter table public.news_stories
  add constraint news_stories_visibility_status_check
  check (visibility_status in ('active', 'excluded')) not valid;

-- Create only after the backfill collision report is reviewed and collisions are resolved.
create unique index if not exists news_stories_district_canonical_url_uidx
  on public.news_stories (district_id, canonical_url)
  where canonical_url is not null;

create table if not exists public.story_correction_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null default gen_random_uuid(),
  district_id text not null,
  story_id uuid not null references public.news_stories(id),
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action in ('manual_add', 'exclude', 'restore')),
  reason text not null check (length(trim(reason)) >= 10),
  before_state jsonb,
  after_state jsonb not null,
  reverses_event_id uuid references public.story_correction_events(id),
  resulting_version integer not null,
  created_at timestamptz not null default now()
);

create index if not exists story_correction_events_story_created_idx
  on public.story_correction_events (story_id, created_at desc);
create index if not exists story_correction_events_district_created_idx
  on public.story_correction_events (district_id, created_at desc);

alter table public.story_correction_events enable row level security;
revoke all on public.story_correction_events from anon, authenticated;

create or replace function public.prevent_story_correction_event_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'story_correction_events is append-only';
end;
$$;

drop trigger if exists story_correction_events_immutable on public.story_correction_events;
create trigger story_correction_events_immutable
before update or delete on public.story_correction_events
for each row execute function public.prevent_story_correction_event_change();

create or replace function public.canary_add_manual_story(
  p_actor_user_id uuid,
  p_district_id text,
  p_canonical_url text,
  p_link text,
  p_headline text,
  p_source text,
  p_date date,
  p_reason text,
  p_summary text default null
)
returns public.news_stories
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  existing public.news_stories;
  created public.news_stories;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A correction reason of at least 10 characters is required';
  end if;
  if p_canonical_url is null or p_canonical_url !~ '^https://' then
    raise exception 'A canonical HTTPS URL is required';
  end if;

  select * into existing
  from public.news_stories
  where district_id = p_district_id and canonical_url = p_canonical_url
  for update;

  if found then
    raise exception using
      message = 'A story with this canonical URL already exists',
      detail = json_build_object('story_id', existing.id, 'visibility_status', existing.visibility_status)::text;
  end if;

  insert into public.news_stories (
    district_id, canonical_url, link, headline, source, date, summary,
    source_type, source_query, visibility_status, manual_override, correction_version
  ) values (
    p_district_id, p_canonical_url, p_link, p_headline, p_source, p_date, p_summary,
    'manual', 'Manual correction', 'active', true, 1
  ) returning * into created;

  insert into public.story_correction_events (
    district_id, story_id, actor_user_id, action, reason,
    before_state, after_state, resulting_version
  ) values (
    p_district_id, created.id, p_actor_user_id, 'manual_add', trim(p_reason),
    null, to_jsonb(created), created.correction_version
  );

  return created;
end;
$$;

create or replace function public.canary_exclude_story(
  p_actor_user_id uuid,
  p_story_id uuid,
  p_reason text,
  p_expected_version integer
)
returns public.news_stories
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.news_stories;
  after_row public.news_stories;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A correction reason of at least 10 characters is required';
  end if;

  select * into before_row from public.news_stories where id = p_story_id for update;
  if not found then raise exception 'Story not found'; end if;
  if before_row.correction_version <> p_expected_version then raise exception 'Story changed; refresh and retry'; end if;
  if before_row.visibility_status = 'excluded' then raise exception 'Story is already excluded'; end if;

  update public.news_stories
  set visibility_status = 'excluded',
      manual_override = true,
      correction_version = correction_version + 1
  where id = p_story_id
  returning * into after_row;

  insert into public.story_correction_events (
    district_id, story_id, actor_user_id, action, reason,
    before_state, after_state, resulting_version
  ) values (
    after_row.district_id, after_row.id, p_actor_user_id, 'exclude', trim(p_reason),
    to_jsonb(before_row), to_jsonb(after_row), after_row.correction_version
  );

  return after_row;
end;
$$;

create or replace function public.canary_restore_story(
  p_actor_user_id uuid,
  p_story_id uuid,
  p_exclusion_event_id uuid,
  p_reason text,
  p_expected_version integer
)
returns public.news_stories
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.news_stories;
  after_row public.news_stories;
  exclusion_event public.story_correction_events;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A correction reason of at least 10 characters is required';
  end if;

  select * into before_row from public.news_stories where id = p_story_id for update;
  if not found then raise exception 'Story not found'; end if;
  if before_row.correction_version <> p_expected_version then raise exception 'Story changed; refresh and retry'; end if;
  if before_row.visibility_status <> 'excluded' then raise exception 'Story is not excluded'; end if;

  select * into exclusion_event
  from public.story_correction_events
  where id = p_exclusion_event_id and story_id = p_story_id and action = 'exclude';
  if not found then raise exception 'Matching exclusion event not found'; end if;

  update public.news_stories
  set visibility_status = 'active',
      manual_override = true,
      correction_version = correction_version + 1
  where id = p_story_id
  returning * into after_row;

  insert into public.story_correction_events (
    district_id, story_id, actor_user_id, action, reason,
    before_state, after_state, reverses_event_id, resulting_version
  ) values (
    after_row.district_id, after_row.id, p_actor_user_id, 'restore', trim(p_reason),
    to_jsonb(before_row), to_jsonb(after_row), exclusion_event.id, after_row.correction_version
  );

  return after_row;
end;
$$;

revoke all on function public.canary_add_manual_story(uuid,text,text,text,text,text,date,text,text) from public, anon, authenticated;
revoke all on function public.canary_exclude_story(uuid,uuid,text,integer) from public, anon, authenticated;
revoke all on function public.canary_restore_story(uuid,uuid,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.canary_add_manual_story(uuid,text,text,text,text,text,date,text,text) to service_role;
grant execute on function public.canary_exclude_story(uuid,uuid,text,integer) to service_role;
grant execute on function public.canary_restore_story(uuid,uuid,uuid,text,integer) to service_role;

-- Intentionally left NOT VALID until the backfill is complete and checked.
-- alter table public.news_stories validate constraint news_stories_visibility_status_check;

commit;
