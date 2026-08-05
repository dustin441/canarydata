-- Read-only Social N-1/N contract verifier. Safe for the verified Canary SQL Editor.
-- Optional inputs before running:
--   set canary.expected_social_state = 'N'; -- N or N-1
--   set canary.expected_social_rows = '1031';
--   set canary.expected_social_exclusions = '20';
begin transaction read only;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $verify$
declare
  expected_state text := nullif(current_setting('canary.expected_social_state', true), '');
  expected_rows bigint := nullif(current_setting('canary.expected_social_rows', true), '')::bigint;
  expected_exclusions bigint := nullif(current_setting('canary.expected_social_exclusions', true), '')::bigint;
  actual_default text;
  actual_check text;
begin
  if to_regclass('public.social_threads') is null then raise exception 'social_threads is absent'; end if;
  select pg_get_expr(d.adbin, d.adrelid) into actual_default
  from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='public.social_threads'::regclass and a.attname='visibility_status';
  select pg_get_constraintdef(c.oid, true) into actual_check from pg_constraint c
  where c.conrelid='public.social_threads'::regclass and c.conname='social_threads_visibility_status_check';
  if expected_state = 'N' then
    if actual_default not in ('''active''::text','''active''')
       or actual_check like '%review%' or actual_check like '%approved%'
       or exists(select 1 from public.social_threads where visibility_status not in ('active','excluded'))
       or to_regclass('public.social_correction_requests') is null
       or to_regprocedure('public.canary_apply_social_correction(uuid,text,uuid,text,integer,text)') is null
       or to_regprocedure('public.canary_ingest_social_thread(jsonb)') is null
       or to_regprocedure('public.canary_review_social_thread(uuid,uuid,text,integer,text,text)') is not null
       or to_regprocedure('public.canary_bulk_review_social_threads(uuid,text,uuid[],text)') is not null then
      raise exception 'Social N contract verification failed';
    end if;
  elsif expected_state = 'N-1' then
    if actual_default not in ('''review''::text','''review''')
       or actual_check not like '%review%approved%active%excluded%'
       or to_regclass('public.social_correction_requests') is not null
       or to_regprocedure('public.canary_apply_social_correction(uuid,text,uuid,text,integer,text)') is not null
       or to_regprocedure('public.canary_ingest_social_thread(jsonb)') is not null
       or to_regprocedure('public.canary_review_social_thread(uuid,uuid,text,integer,text,text)') is null
       or to_regprocedure('public.canary_bulk_review_social_threads(uuid,text,uuid[],text)') is null then
      raise exception 'Social N-1 contract verification failed';
    end if;
  elsif expected_state is not null then raise exception 'Expected state must be N or N-1'; end if;
  if expected_rows is not null and expected_rows <> (select count(*) from public.social_threads) then
    raise exception 'Social row count mismatch';
  end if;
  if expected_exclusions is not null and expected_exclusions <> (select count(*) from public.social_threads where visibility_status='excluded') then
    raise exception 'Social exclusion count mismatch';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('social_threads','social_review_batches','social_review_events')
      and (not c.relrowsecurity or c.relforcerowsecurity)
  ) then raise exception 'Social RLS flags differ from captured baseline'; end if;
end
$verify$;

with affected_relations as (
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in
    ('social_threads','social_review_batches','social_review_events','social_correction_requests')
), contract as (
  select 'column'::text kind, c.table_name||'.'||c.column_name name,
    concat_ws('|',c.data_type,c.udt_name,c.is_nullable,coalesce(c.column_default,'<null>')) definition
  from information_schema.columns c
  where c.table_schema='public' and c.table_name in
    ('social_threads','social_review_batches','social_review_events','social_correction_requests')
  union all
  select 'constraint', r.relname||'.'||con.conname, pg_get_constraintdef(con.oid,true)
  from pg_constraint con join affected_relations r on r.oid=con.conrelid
  union all
  select 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in
    ('canary_assert_social_reviewer','canary_review_social_thread','canary_bulk_review_social_threads',
     'canary_apply_social_correction','canary_ingest_social_thread','prevent_social_review_audit_mutation','touch_social_updated_at')
  union all
  select 'trigger', r.relname||'.'||t.tgname, pg_get_triggerdef(t.oid,true)
  from pg_trigger t join affected_relations r on r.oid=t.tgrelid where not t.tgisinternal
  union all
  select 'index', i.tablename||'.'||i.indexname, i.indexdef
  from pg_indexes i where i.schemaname='public' and i.tablename in
    ('social_threads','social_review_batches','social_review_events','social_correction_requests')
  union all
  select 'table_grant', g.table_name||':'||g.grantee||':'||g.privilege_type,
    concat_ws('|',g.grantor,g.is_grantable)
  from information_schema.role_table_grants g where g.table_schema='public' and g.table_name in
    ('social_threads','social_review_batches','social_review_events','social_correction_requests')
  union all
  select 'function_grant', r.routine_name||':'||r.grantee||':'||r.privilege_type,
    concat_ws('|',r.grantor,r.is_grantable)
  from information_schema.routine_privileges r where r.routine_schema='public' and r.routine_name in
    ('canary_assert_social_reviewer','canary_review_social_thread','canary_bulk_review_social_threads',
     'canary_apply_social_correction','canary_ingest_social_thread')
  union all
  select 'policy', p.tablename||'.'||p.policyname,
    concat_ws('|',p.permissive,array_to_string(p.roles,','),p.cmd,coalesce(p.qual,'<null>'),coalesce(p.with_check,'<null>'))
  from pg_policies p where p.schemaname='public' and p.tablename in
    ('social_threads','social_review_batches','social_review_events','social_correction_requests')
  union all
  select 'rls', relname, concat_ws('|',relrowsecurity,relforcerowsecurity) from affected_relations
), status_counts as (
  select coalesce(jsonb_object_agg(visibility_status,n order by visibility_status),'{}'::jsonb) value
  from (select visibility_status,count(*) n from public.social_threads group by visibility_status) x
), relationship_counts as (
  select coalesce(jsonb_agg(to_jsonb(x) order by visibility_status,relationship_type),'[]'::jsonb) value
  from (select visibility_status,relationship_type,count(*) n from public.social_threads group by 1,2) x
), official_set as (
  select t.id from public.social_threads t join public.social_accounts a on a.id=t.social_account_id
  where t.relationship_type='owned' and a.district_id=t.district_id and a.platform=t.platform and a.active
    and (nullif(btrim(a.handle),'') is not null or nullif(btrim(a.profile_url),'') is not null)
), object_rows as (
  select jsonb_agg(jsonb_build_object('kind',kind,'name',name,'md5',md5(definition)) order by kind,name) objects,
         md5(string_agg(kind||E'\x1f'||name||E'\x1f'||definition,E'\x1e' order by kind,name)) fingerprint
  from contract
)
select jsonb_pretty(jsonb_build_object(
  'captured_at_utc',timezone('utc',now()),'server_version',current_setting('server_version'),
  'schema_identity','canary-social-visibility-v2','schema_fingerprint_md5',object_rows.fingerprint,
  'objects',object_rows.objects,'row_count',(select count(*) from public.social_threads),
  'exclusion_count',(select count(*) from public.social_threads where visibility_status='excluded'),
  'status_counts',status_counts.value,'status_relationship_counts',relationship_counts.value,
  'official_report_set_count',(select count(*) from official_set),
  'official_report_set_md5',(select md5(coalesce(string_agg(id::text,',' order by id),'')) from official_set),
  'review_version_min',(select min(review_version) from public.social_threads),
  'review_version_max',(select max(review_version) from public.social_threads),
  'review_version_nulls',(select count(*) from public.social_threads where review_version is null)
)) as social_visibility_contract
from object_rows,status_counts,relationship_counts;
rollback;
