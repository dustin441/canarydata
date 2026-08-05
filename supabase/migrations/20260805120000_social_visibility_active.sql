-- Task 5: collapse Social visibility to active/excluded after Task 4 is installed.
-- Run manually in the verified Canary production Supabase SQL Editor only after a verified backup.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('canary-social-visibility-v2', 0));
lock table public.social_threads in share row exclusive mode;

do $preflight$
declare
  current_default text;
  current_constraint text;
  captured_shared boolean;
  is_n1 boolean;
  is_n boolean;
begin
  if to_regclass('public.social_threads') is null
     or to_regclass('public.social_correction_requests') is null
     or to_regprocedure('public.canary_apply_social_correction(uuid,text,uuid,text,integer,text)') is null
     or to_regprocedure('public.canary_ingest_social_thread(jsonb)') is null then
    raise exception 'Task 4 Social lifecycle objects are required before Task 5';
  end if;

  select pg_get_expr(d.adbin, d.adrelid)
    into current_default
  from pg_attribute a
  join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = 'public.social_threads'::regclass and a.attname = 'visibility_status';

  select pg_get_constraintdef(c.oid, true)
    into current_constraint
  from pg_constraint c
  where c.conrelid = 'public.social_threads'::regclass
    and c.conname = 'social_threads_visibility_status_check';

  captured_shared := coalesce(md5(pg_get_functiondef(to_regprocedure('public.canary_assert_social_reviewer(uuid)'))) = 'f8acecd019a7182f9394ca2ce1d78a67', false)
    and coalesce(md5(pg_get_functiondef(to_regprocedure('public.prevent_social_review_audit_mutation()'))) = '7f325916f94da40cbf15014e320345d6', false)
    and coalesce(md5(pg_get_functiondef(to_regprocedure('public.touch_social_updated_at()'))) = 'feff1b4a6c026311cd0a6164d5f96a65', false);

  is_n1 := captured_shared
    and current_default in ('''review''::text', '''review''')
    and current_constraint like '%review%approved%active%excluded%'
    and coalesce(md5(pg_get_functiondef(to_regprocedure('public.canary_review_social_thread(uuid,uuid,text,integer,text,text)'))) = 'c4f851bf607f11545d47ef2b04b29740', false)
    and coalesce(md5(pg_get_functiondef(to_regprocedure('public.canary_bulk_review_social_threads(uuid,text,uuid[],text)'))) = '8bd52d87cc68594f993f0e8f4b7c29bb', false);
  is_n := captured_shared
    and current_default in ('''active''::text', '''active''')
    and current_constraint not like '%review%'
    and current_constraint not like '%approved%'
    and current_constraint like '%active%excluded%'
    and to_regprocedure('public.canary_review_social_thread(uuid,uuid,text,integer,text,text)') is null
    and to_regprocedure('public.canary_bulk_review_social_threads(uuid,text,uuid[],text)') is null
    and not exists (select 1 from public.social_threads where visibility_status not in ('active', 'excluded'));

  if is_n then
    raise notice 'Task 5 is already in a safely proven N state';
  elsif not is_n1 then
    raise exception 'Social visibility schema is neither the captured N-1 contract nor a proven N contract';
  end if;
  if exists (select 1 from pg_trigger where tgrelid='public.social_threads'::regclass and not tgisinternal and (tgname <> 'social_threads_touch_updated_at' or tgenabled <> 'O'))
     or not exists (select 1 from pg_trigger where tgrelid='public.social_threads'::regclass and not tgisinternal and tgname = 'social_threads_touch_updated_at' and tgenabled = 'O') then
    raise exception 'Captured enabled social_threads trigger contract is required';
  end if;
end
$preflight$;

-- Mapping is deterministic and deliberately independent of official-account eligibility.
-- Preserve the captured updated_at values while changing only visibility_status.
do $trigger$ begin
  if exists (select 1 from pg_trigger where tgrelid='public.social_threads'::regclass and tgname='social_threads_touch_updated_at') then
    alter table public.social_threads disable trigger social_threads_touch_updated_at;
  end if;
end $trigger$;
update public.social_threads
set visibility_status = 'active'
where visibility_status in ('review', 'approved');
do $trigger$ begin
  if exists (select 1 from pg_trigger where tgrelid='public.social_threads'::regclass and tgname='social_threads_touch_updated_at') then
    alter table public.social_threads enable trigger social_threads_touch_updated_at;
  end if;
end $trigger$;

alter table public.social_threads alter column visibility_status set default 'active';
alter table public.social_threads drop constraint social_threads_visibility_status_check;
alter table public.social_threads add constraint social_threads_visibility_status_check
  check (visibility_status in ('active', 'excluded')) not valid;
alter table public.social_threads validate constraint social_threads_visibility_status_check;

-- Old review RPCs encode N-1 approval semantics and must not coexist with the N lifecycle.
drop function if exists public.canary_review_social_thread(uuid, uuid, text, integer, text, text);
drop function if exists public.canary_bulk_review_social_threads(uuid, text, uuid[], text);

commit;
