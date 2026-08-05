-- Task 5 reverse schema migration. This restores the captured N-1 object contract only.
-- Exact pre-cutover row states must subsequently be restored with restore-social-visibility.mjs.
-- Run manually in the verified Canary production Supabase SQL Editor.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('canary-social-visibility-v2', 0));
lock table public.social_threads in share row exclusive mode;

do $preflight$
declare
  current_default text;
  current_constraint text;
begin
  if to_regclass('public.social_threads') is null
     or to_regclass('public.social_correction_requests') is null
     or to_regprocedure('public.canary_apply_social_correction(uuid,text,uuid,text,integer,text)') is null
     or to_regprocedure('public.canary_ingest_social_thread(jsonb)') is null then
    raise exception 'A complete Task 4/Task 5 N state is required for schema reversal';
  end if;
  if exists (select 1 from public.social_threads where visibility_status not in ('active', 'excluded')) then
    raise exception 'Unexpected Social status in N state';
  end if;
  select pg_get_expr(d.adbin, d.adrelid) into current_default
  from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = 'public.social_threads'::regclass and a.attname = 'visibility_status';
  select pg_get_constraintdef(c.oid, true) into current_constraint
  from pg_constraint c
  where c.conrelid = 'public.social_threads'::regclass and c.conname = 'social_threads_visibility_status_check';
  if current_default not in ('''active''::text', '''active''')
     or current_constraint like '%review%' or current_constraint like '%approved%'
     or current_constraint not like '%active%excluded%' then
    raise exception 'Exact Task 5 N visibility contract is required for reversal';
  end if;
  if not coalesce(md5(pg_get_functiondef(to_regprocedure('public.canary_assert_social_reviewer(uuid)'))) = 'f8acecd019a7182f9394ca2ce1d78a67', false)
     or not coalesce(md5(pg_get_functiondef(to_regprocedure('public.prevent_social_review_audit_mutation()'))) = '7f325916f94da40cbf15014e320345d6', false)
     or not coalesce(md5(pg_get_functiondef(to_regprocedure('public.touch_social_updated_at()'))) = 'feff1b4a6c026311cd0a6164d5f96a65', false) then
    raise exception 'Captured shared Social function contract is absent';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.social_threads'::regclass and not tgisinternal and (tgname <> 'social_threads_touch_updated_at' or tgenabled <> 'O'))
     or not exists (select 1 from pg_trigger where tgrelid = 'public.social_threads'::regclass and not tgisinternal and tgname = 'social_threads_touch_updated_at' and tgenabled = 'O') then
    raise exception 'Captured enabled social_threads trigger contract is required';
  end if;
  if to_regprocedure('public.canary_review_social_thread(uuid,uuid,text,integer,text,text)') is not null
     or to_regprocedure('public.canary_bulk_review_social_threads(uuid,text,uuid[],text)') is not null then
    raise exception 'Legacy Social review RPCs unexpectedly coexist with N';
  end if;
end
$preflight$;

-- Remove only Task 4 objects. Existing Social rows and audit history are never deleted.
drop function public.canary_apply_social_correction(uuid, text, uuid, text, integer, text);
drop function public.canary_ingest_social_thread(jsonb);
drop table public.social_correction_requests;

alter table public.social_threads
  add column if not exists reviewer_note text,
  add column if not exists review_version integer not null default 0;
alter table public.social_threads alter column visibility_status set default 'review';

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
  district_id text not null references public.districts(id) on delete restrict,
  action text not null check (action in ('approve', 'exclude', 'restore', 'classification', 'note', 'bulk_approve_official', 'promote')),
  actor_user_id uuid not null,
  item_count integer not null check (item_count > 0),
  criteria jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.social_review_events (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.social_review_batches(id) on delete restrict,
  district_id text not null references public.districts(id) on delete restrict,
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

create or replace function public.canary_assert_social_reviewer(p_actor_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_role text;
begin
  select raw_app_meta_data ->> 'role'
    into actor_role
  from auth.users
  where id = p_actor_user_id;
  if actor_role is distinct from 'admin' then
    raise exception 'Canary reviewer access is required';
  end if;
end;
$$;

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
  perform public.canary_assert_social_reviewer(p_actor_user_id);
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
  perform public.canary_assert_social_reviewer(p_actor_user_id);
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
      and visibility_status = 'review'
      and exists (
        select 1
        from public.social_accounts account
        where account.id = social_threads.social_account_id
          and account.district_id = social_threads.district_id
          and account.platform = social_threads.platform
          and account.active = true
          and (nullif(btrim(account.handle), '') is not null or nullif(btrim(account.profile_url), '') is not null)
      );
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
revoke all on function public.canary_assert_social_reviewer(uuid) from public, anon, authenticated;
grant execute on function public.canary_review_social_thread(uuid, uuid, text, integer, text, text) to service_role;
grant execute on function public.canary_bulk_review_social_threads(uuid, text, uuid[], text) to service_role;
grant execute on function public.canary_assert_social_reviewer(uuid) to service_role;

commit;
