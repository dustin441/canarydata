-- Read-only production verification after applying 20260812162000_social_discovery_candidate_gate.sql.
\set ON_ERROR_STOP on

with contract as (
  select regexp_replace(pg_get_constraintdef(c.oid,true), '\s+', ' ', 'g') as definition
  from pg_constraint c
  where c.conrelid='public.social_threads'::regclass
    and c.conname='social_threads_visibility_status_check'
), tenant_fk as (
  select pg_get_constraintdef(c.oid,true) as definition
  from pg_constraint c
  where c.conrelid='public.social_discovery_candidates'::regclass
    and c.contype='f'
    and c.conkey = array[
      (select attnum from pg_attribute where attrelid=c.conrelid and attname='promoted_social_thread_id'),
      (select attnum from pg_attribute where attrelid=c.conrelid and attname='district_id')
    ]::smallint[]
)
select jsonb_build_object(
  'project_contract', 'active_excluded',
  'exact_visibility_constraint', (select definition='CHECK (visibility_status = ANY (ARRAY[''active''::text, ''excluded''::text]))' from contract),
  'candidate_table', to_regclass('public.social_discovery_candidates') is not null,
  'request_table', to_regclass('public.social_discovery_review_requests') is not null,
  'event_table', to_regclass('public.social_discovery_review_events') is not null,
  'stage_rpc', to_regprocedure('public.canary_stage_social_discovery(jsonb)') is not null,
  'review_rpc', to_regprocedure('public.canary_review_social_discovery(uuid,text,uuid,text,integer,text,text)') is not null,
  'composite_promotion_tenant_fk', exists(select 1 from tenant_fk),
  'pending_candidates', (select count(*) from public.social_discovery_candidates where status='pending'),
  'reviewed_candidates', (select count(*) from public.social_discovery_candidates where status<>'pending'),
  'review_events', (select count(*) from public.social_discovery_review_events),
  'invalid_visibility_rows', (select count(*) from public.social_threads where visibility_status not in ('active','excluded')),
  'cross_district_promotion_links', (select count(*) from public.social_discovery_candidates c join public.social_threads t on t.id=c.promoted_social_thread_id where t.district_id<>c.district_id),
  'anon_candidate_privilege', has_table_privilege('anon','public.social_discovery_candidates','select,insert,update,delete'),
  'authenticated_candidate_privilege', has_table_privilege('authenticated','public.social_discovery_candidates','select,insert,update,delete'),
  'service_stage_execute', has_function_privilege('service_role','public.canary_stage_social_discovery(jsonb)','execute'),
  'anon_stage_execute', has_function_privilege('anon','public.canary_stage_social_discovery(jsonb)','execute'),
  'authenticated_review_execute', has_function_privilege('authenticated','public.canary_review_social_discovery(uuid,text,uuid,text,integer,text,text)','execute')
) as social_discovery_gate_verification;
