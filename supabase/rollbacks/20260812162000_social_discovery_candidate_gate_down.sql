-- Guarded rollback for 20260812162000_social_discovery_candidate_gate.sql.
-- Refuses destructive removal if the gate is partial or any reviewed decision exists.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('canary-social-discovery-candidate-gate', 0));

do $rollback$
declare
  object_count integer;
  support_constraint_valid boolean;
  queue_index_valid boolean;
begin
  select
    (to_regclass('public.social_discovery_candidates') is not null)::integer
    + (to_regclass('public.social_discovery_review_events') is not null)::integer
    + (to_regclass('public.social_discovery_review_requests') is not null)::integer
    + (to_regprocedure('public.canary_review_social_discovery(uuid,text,uuid,text,integer,text,text)') is not null)::integer
    + (to_regprocedure('public.canary_stage_social_discovery(jsonb)') is not null)::integer
    + (to_regprocedure('public.guard_social_discovery_review_request_mutation()') is not null)::integer
    + (to_regprocedure('public.prevent_social_discovery_audit_mutation()') is not null)::integer
    + exists (
        select 1 from pg_constraint
        where conrelid = 'public.social_threads'::regclass
          and conname = 'social_threads_id_district_unique'
      )::integer
    + (to_regclass('public.social_discovery_candidates_queue_idx') is not null)::integer
    + exists (
        select 1 from pg_trigger
        where tgrelid = to_regclass('public.social_discovery_review_requests')
          and tgname = 'social_discovery_review_requests_immutable'
          and not tgisinternal
      )::integer
    + exists (
        select 1 from pg_trigger
        where tgrelid = to_regclass('public.social_discovery_review_events')
          and tgname = 'social_discovery_review_events_immutable'
          and not tgisinternal
      )::integer
  into object_count;

  if object_count = 0 then
    raise notice 'Social discovery candidate gate is already absent';
    return;
  end if;

  if object_count <> 11 then
    raise exception 'Refusing rollback from a partial Social discovery candidate gate; inspect objects first (% of 11 present)', object_count;
  end if;

  select
    pg_get_constraintdef(c.oid, true) = 'UNIQUE (id, district_id)'
    and obj_description(c.oid, 'pg_constraint') = 'canary_social_discovery_candidate_gate:20260812162000'
  into support_constraint_valid
  from pg_constraint c
  where c.conrelid = 'public.social_threads'::regclass
    and c.conname = 'social_threads_id_district_unique';

  select
    pg_get_indexdef(i.indexrelid) = 'CREATE INDEX social_discovery_candidates_queue_idx ON public.social_discovery_candidates USING btree (district_id, status, last_seen_at DESC, id)'
    and obj_description(i.indexrelid, 'pg_class') = 'canary_social_discovery_candidate_gate:20260812162000'
  into queue_index_valid
  from pg_index i
  where i.indexrelid = 'public.social_discovery_candidates_queue_idx'::regclass;

  if support_constraint_valid is not true or queue_index_valid is not true then
    raise exception 'Refusing rollback because Social discovery gate object ownership or definitions do not match';
  end if;

  if exists (
       select 1 from public.social_discovery_candidates
       where status <> 'pending' or promoted_social_thread_id is not null
     )
     or exists (select 1 from public.social_discovery_review_events)
     or exists (select 1 from public.social_discovery_review_requests) then
    raise exception 'Refusing rollback while reviewed Social discovery history exists';
  end if;

  drop function public.canary_review_social_discovery(uuid,text,uuid,text,integer,text,text);
  drop function public.canary_stage_social_discovery(jsonb);
  drop table public.social_discovery_review_events;
  drop table public.social_discovery_review_requests;
  drop table public.social_discovery_candidates;
  drop function public.guard_social_discovery_review_request_mutation();
  drop function public.prevent_social_discovery_audit_mutation();
  alter table public.social_threads drop constraint social_threads_id_district_unique;
end
$rollback$;

commit;
