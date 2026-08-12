-- Guarded rollback for 20260812162000_social_discovery_candidate_gate.sql.
-- Refuses destructive removal if any reviewed decision or promoted thread exists.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('canary-social-discovery-candidate-gate', 0));

do $$
begin
  if to_regclass('public.social_discovery_candidates') is null then
    raise notice 'Social discovery candidate gate is already absent';
    return;
  end if;
  if exists (select 1 from public.social_discovery_candidates where status <> 'pending' or promoted_social_thread_id is not null)
     or exists (select 1 from public.social_discovery_review_events)
     or exists (select 1 from public.social_discovery_review_requests) then
    raise exception 'Refusing rollback while reviewed Social discovery history exists';
  end if;
end $$;

drop function if exists public.canary_review_social_discovery(uuid,text,uuid,text,integer,text,text);
drop function if exists public.canary_stage_social_discovery(jsonb);
drop trigger if exists social_discovery_review_events_immutable on public.social_discovery_review_events;
drop trigger if exists social_discovery_review_requests_immutable on public.social_discovery_review_requests;
drop function if exists public.guard_social_discovery_review_request_mutation();
drop function if exists public.prevent_social_discovery_audit_mutation();
drop table if exists public.social_discovery_review_events;
drop table if exists public.social_discovery_review_requests;
drop table if exists public.social_discovery_candidates;

commit;
