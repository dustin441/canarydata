-- Canary Social review workflow
-- Apply to the verified Canary production project before deploying application code that selects these fields.

begin;

alter table public.social_threads
  add column if not exists reviewer_note text,
  add column if not exists review_version integer not null default 0;

alter table public.social_threads
  drop constraint if exists social_threads_visibility_status_check;
alter table public.social_threads
  add constraint social_threads_visibility_status_check
  check (visibility_status in ('review', 'approved', 'active', 'excluded')) not valid;
alter table public.social_threads validate constraint social_threads_visibility_status_check;

alter table public.social_threads
  drop constraint if exists social_threads_reviewer_note_length_check;
alter table public.social_threads
  add constraint social_threads_reviewer_note_length_check
  check (reviewer_note is null or char_length(reviewer_note) <= 2000) not valid;
alter table public.social_threads validate constraint social_threads_reviewer_note_length_check;

create table if not exists public.social_review_batches (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete cascade,
  action text not null check (action in ('approve', 'exclude', 'restore', 'classification', 'note', 'bulk_approve_official', 'promote')),
  actor_user_id uuid not null,
  item_count integer not null check (item_count > 0),
  criteria jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.social_review_events (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.social_review_batches(id) on delete restrict,
  district_id text not null references public.districts(id) on delete cascade,
  social_thread_id uuid not null references public.social_threads(id) on delete restrict,
  actor_user_id uuid not null,
  action text not null check (action in ('approve', 'exclude', 'restore', 'classification', 'note', 'promote')),
  before_state jsonb not null,
  after_state jsonb not null,
  resulting_version integer not null check (resulting_version > 0),
  created_at timestamptz not null default now()
);

create index if not exists social_review_batches_district_created_idx
  on public.social_review_batches (district_id, created_at desc);
create index if not exists social_review_events_district_created_idx
  on public.social_review_events (district_id, created_at desc);
create index if not exists social_review_events_thread_created_idx
  on public.social_review_events (social_thread_id, created_at desc);

alter table public.social_review_batches enable row level security;
alter table public.social_review_events enable row level security;

create or replace function public.prevent_social_review_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Social review audit records are immutable';
end;
$$;

drop trigger if exists social_review_batches_immutable on public.social_review_batches;
create trigger social_review_batches_immutable
before update or delete on public.social_review_batches
for each row execute function public.prevent_social_review_audit_mutation();

drop trigger if exists social_review_events_immutable on public.social_review_events;
create trigger social_review_events_immutable
before update or delete on public.social_review_events
for each row execute function public.prevent_social_review_audit_mutation();

create or replace function public.canary_review_social_thread(
  p_actor_user_id uuid,
  p_social_thread_id uuid,
  p_action text,
  p_expected_version integer,
  p_classification text default null,
  p_reviewer_note text default null
)
returns public.social_threads
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row public.social_threads%rowtype;
  after_row public.social_threads%rowtype;
  new_batch_id uuid;
begin
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;
  if p_action not in ('approve', 'exclude', 'restore', 'classification', 'note', 'promote') then
    raise exception 'Unsupported social review action';
  end if;
  if p_action = 'classification' and p_classification not in ('owned', 'direct_tag', 'direct_mention', 'ambient') then
    raise exception 'Unsupported social classification';
  end if;
  if p_action = 'note' and char_length(coalesce(p_reviewer_note, '')) > 2000 then
    raise exception 'Reviewer note must be 2000 characters or fewer';
  end if;

  select * into before_row
  from public.social_threads
  where id = p_social_thread_id
  for update;
  if not found then raise exception 'Social result not found'; end if;
  if before_row.review_version <> p_expected_version then
    raise exception 'Social result changed; refresh and try again';
  end if;

  if p_action = 'approve' then
    if before_row.visibility_status <> 'review' then raise exception 'Only review results can be approved'; end if;
    update public.social_threads
      set visibility_status = 'approved', reviewed_at = now(), reviewed_by = p_actor_user_id,
          review_version = review_version + 1
      where id = before_row.id returning * into after_row;
  elsif p_action = 'exclude' then
    if before_row.visibility_status = 'excluded' then raise exception 'Social result is already excluded'; end if;
    update public.social_threads
      set visibility_status = 'excluded', reviewed_at = now(), reviewed_by = p_actor_user_id,
          review_version = review_version + 1
      where id = before_row.id returning * into after_row;
  elsif p_action = 'restore' then
    if before_row.visibility_status <> 'excluded' then raise exception 'Only excluded results can be restored'; end if;
    update public.social_threads
      set visibility_status = 'review', reviewed_at = now(), reviewed_by = p_actor_user_id,
          review_version = review_version + 1
      where id = before_row.id returning * into after_row;
  elsif p_action = 'promote' then
    if before_row.visibility_status <> 'approved' then raise exception 'Only approved results can be promoted'; end if;
    update public.social_threads
      set visibility_status = 'active', reviewed_at = now(), reviewed_by = p_actor_user_id,
          review_version = review_version + 1
      where id = before_row.id returning * into after_row;
  elsif p_action = 'classification' then
    update public.social_threads
      set relationship_type = p_classification, review_version = review_version + 1
      where id = before_row.id returning * into after_row;
  else
    update public.social_threads
      set reviewer_note = nullif(btrim(coalesce(p_reviewer_note, '')), ''), review_version = review_version + 1
      where id = before_row.id returning * into after_row;
  end if;

  insert into public.social_review_batches (district_id, action, actor_user_id, item_count, criteria)
  values (before_row.district_id, p_action, p_actor_user_id, 1, jsonb_build_object('social_thread_id', before_row.id))
  returning id into new_batch_id;

  insert into public.social_review_events (
    batch_id, district_id, social_thread_id, actor_user_id, action,
    before_state, after_state, resulting_version
  ) values (
    new_batch_id, before_row.district_id, before_row.id, p_actor_user_id, p_action,
    to_jsonb(before_row), to_jsonb(after_row), after_row.review_version
  );

  return after_row;
end;
$$;

create or replace function public.canary_bulk_review_social_threads(
  p_actor_user_id uuid,
  p_district_id text,
  p_social_thread_ids uuid[],
  p_action text
)
returns table (batch_id uuid, item_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  eligible_count integer;
  new_batch_id uuid;
  row_before public.social_threads%rowtype;
  row_after public.social_threads%rowtype;
begin
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;
  if p_district_id is null then raise exception 'District is required'; end if;
  if p_action not in ('approve_official', 'promote') then raise exception 'Unsupported bulk social review action'; end if;

  select count(distinct selected.id)::integer into expected_count
  from unnest(coalesce(p_social_thread_ids, '{}'::uuid[])) as selected(id);
  if expected_count < 1 or expected_count > 250 then raise exception 'Select between 1 and 250 social results'; end if;

  perform 1 from public.social_threads
  where id = any(p_social_thread_ids)
  order by id
  for update;

  if p_action = 'approve_official' then
    select count(*)::integer into eligible_count
    from public.social_threads
    where id = any(p_social_thread_ids)
      and district_id = p_district_id
      and relationship_type = 'owned'
      and visibility_status = 'review';
  else
    select count(*)::integer into eligible_count
    from public.social_threads
    where id = any(p_social_thread_ids)
      and district_id = p_district_id
      and visibility_status = 'approved';
  end if;

  if eligible_count <> expected_count then
    raise exception 'Selection contains missing, cross-district, or ineligible social results';
  end if;

  insert into public.social_review_batches (district_id, action, actor_user_id, item_count, criteria)
  values (
    p_district_id,
    case when p_action = 'approve_official' then 'bulk_approve_official' else 'promote' end,
    p_actor_user_id,
    expected_count,
    jsonb_build_object('social_thread_ids', p_social_thread_ids)
  ) returning id into new_batch_id;

  for row_before in
    select * from public.social_threads where id = any(p_social_thread_ids) order by id for update
  loop
    if p_action = 'approve_official' then
      update public.social_threads
        set visibility_status = 'approved', reviewed_at = now(), reviewed_by = p_actor_user_id,
            review_version = review_version + 1
        where id = row_before.id returning * into row_after;
    else
      update public.social_threads
        set visibility_status = 'active', reviewed_at = now(), reviewed_by = p_actor_user_id,
            review_version = review_version + 1
        where id = row_before.id returning * into row_after;
    end if;

    insert into public.social_review_events (
      batch_id, district_id, social_thread_id, actor_user_id, action,
      before_state, after_state, resulting_version
    ) values (
      new_batch_id, row_before.district_id, row_before.id, p_actor_user_id,
      case when p_action = 'approve_official' then 'approve' else 'promote' end,
      to_jsonb(row_before), to_jsonb(row_after), row_after.review_version
    );
  end loop;

  return query select new_batch_id, expected_count;
end;
$$;

revoke all on function public.canary_review_social_thread(uuid, uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.canary_bulk_review_social_threads(uuid, text, uuid[], text) from public, anon, authenticated;
grant execute on function public.canary_review_social_thread(uuid, uuid, text, integer, text, text) to service_role;
grant execute on function public.canary_bulk_review_social_threads(uuid, text, uuid[], text) to service_role;

commit;
