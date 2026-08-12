-- Read-only production verification after applying 20260812162000_social_discovery_candidate_gate.sql.
\set ON_ERROR_STOP on

select jsonb_build_object(
  'project_contract', 'active_excluded',
  'candidate_table', to_regclass('public.social_discovery_candidates') is not null,
  'request_table', to_regclass('public.social_discovery_review_requests') is not null,
  'event_table', to_regclass('public.social_discovery_review_events') is not null,
  'stage_rpc', to_regprocedure('public.canary_stage_social_discovery(jsonb)') is not null,
  'review_rpc', to_regprocedure('public.canary_review_social_discovery(uuid,text,uuid,text,integer,text,text)') is not null,
  'pending_candidates', (select count(*) from public.social_discovery_candidates where status='pending'),
  'reviewed_candidates', (select count(*) from public.social_discovery_candidates where status<>'pending'),
  'review_events', (select count(*) from public.social_discovery_review_events),
  'invalid_visibility_rows', (select count(*) from public.social_threads where visibility_status not in ('active','excluded')),
  'anon_candidate_privilege', has_table_privilege('anon','public.social_discovery_candidates','select,insert,update,delete'),
  'authenticated_candidate_privilege', has_table_privilege('authenticated','public.social_discovery_candidates','select,insert,update,delete'),
  'service_stage_execute', has_function_privilege('service_role','public.canary_stage_social_discovery(jsonb)','execute'),
  'anon_stage_execute', has_function_privilege('anon','public.canary_stage_social_discovery(jsonb)','execute'),
  'authenticated_review_execute', has_function_privilege('authenticated','public.canary_review_social_discovery(uuid,text,uuid,text,integer,text,text)','execute')
) as social_discovery_gate_verification;
