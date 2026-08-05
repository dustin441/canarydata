-- Non-sealing exact restored N-1 verifier.
-- Baseline capture: run against the captured pure N-1 database with no canary.expected_* settings.
-- Restored verification: set all four values from sealed artifacts before running:
--   set canary.expected_task4_table_oid = '12345';
--   set canary.expected_task4_apply_oid = '12346';
--   set canary.expected_task4_ingest_oid = '12347';
--   set canary.expected_pure_n1_fingerprint = '0123456789abcdef0123456789abcdef';
begin transaction read only;
set local statement_timeout='60s';
set local lock_timeout='5s';

do $guard$
declare
  table_oid text := nullif(current_setting('canary.expected_task4_table_oid',true),'');
  apply_oid text := nullif(current_setting('canary.expected_task4_apply_oid',true),'');
  ingest_oid text := nullif(current_setting('canary.expected_task4_ingest_oid',true),'');
  expected_fingerprint text := nullif(current_setting('canary.expected_pure_n1_fingerprint',true),'');
  actual_default text;
  actual_check text;
  task4_table_candidate_count bigint;
begin
  if to_regclass('public.social_threads') is null then raise exception 'social_threads is absent'; end if;
  if (table_oid is null) <> (apply_oid is null) or (table_oid is null) <> (ingest_oid is null) or (table_oid is null) <> (expected_fingerprint is null) then
    raise exception 'Restored verification requires all expected Task 4 OIDs and pure N-1 fingerprint together';
  end if;
  if table_oid is not null then
    if table_oid !~ '^[1-9][0-9]*$' or apply_oid !~ '^[1-9][0-9]*$' or ingest_oid !~ '^[1-9][0-9]*$' or expected_fingerprint !~ '^[a-f0-9]{32}$' then
      raise exception 'Expected Task 4 OIDs or pure N-1 fingerprint are invalid';
    end if;
    if exists(select 1 from pg_class where oid=table_oid::oid)
       or exists(select 1 from pg_proc where oid in (apply_oid::oid,ingest_oid::oid)) then
      raise exception 'Captured Task 4 object OIDs still exist; restored N-1 verification failed';
    end if;
  end if;
  if to_regclass('public.social_correction_requests') is not null
     or to_regprocedure('public.canary_apply_social_correction(uuid,text,uuid,text,integer,text)') is not null
     or to_regprocedure('public.canary_ingest_social_thread(jsonb)') is not null then
    raise exception 'Named Task 4 objects remain in restored N-1';
  end if;
  select count(*) into task4_table_candidate_count
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and (
    (exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.attname='actor_user_id' and a.atttypid='uuid'::regtype and a.attnotnull)
      and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.attname='idempotency_key' and a.atttypid='text'::regtype and a.attnotnull)
      and (select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and (
        (a.attname='request_payload' and a.atttypid='jsonb'::regtype)
        or (a.attname='result_row' and a.atttypid='jsonb'::regtype)
        or (a.attname='completed_at' and a.atttypid='timestamptz'::regtype)))>=1)
    or
    (exists(select 1 from pg_constraint con where con.conrelid=c.oid and con.contype='c'
        and pg_get_constraintdef(con.oid,true) like 'CHECK (% ~ ''^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$''::text)')
      and exists(select 1 from pg_constraint con where con.conrelid=c.oid and con.contype='p'
        and cardinality(con.conkey)=2
        and (select array_agg(a.atttypid order by a.atttypid) from unnest(con.conkey) k(attnum) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum)
          = (select array_agg(x order by x) from unnest(array['uuid'::regtype::oid,'text'::regtype::oid]) x))
      and exists(select 1 from pg_constraint con where con.conrelid=c.oid and con.contype='c'
        and pg_get_constraintdef(con.oid,true) like 'CHECK (%IS NULL AND %IS NULL OR %IS NOT NULL AND %IS NOT NULL)'))
  );
  if task4_table_candidate_count<>0 then
    raise exception 'Task 4 table candidates remain in restored N-1';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r'
        and c.relname in ('social_threads','social_review_batches','social_review_events')
        and pg_get_userbyid(c.relowner)='postgres') <> 3 then
    raise exception 'Restored Social relation ownership differs from exact postgres baseline';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public'
        and p.proname in ('canary_assert_social_reviewer','canary_review_social_thread','canary_bulk_review_social_threads','prevent_social_review_audit_mutation','touch_social_updated_at')
        and pg_get_userbyid(p.proowner)<>'postgres') then
    raise exception 'Restored Social function ownership differs from exact postgres baseline';
  end if;
  select pg_get_expr(d.adbin,d.adrelid) into actual_default from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.social_threads'::regclass and a.attname='visibility_status';
  select pg_get_constraintdef(c.oid,true) into actual_check from pg_constraint c
    where c.conrelid='public.social_threads'::regclass and c.conname='social_threads_visibility_status_check';
  if actual_default not in ('''review''::text','''review''')
     or actual_check is distinct from 'CHECK (visibility_status = ANY (ARRAY[''review''::text, ''approved''::text, ''active''::text, ''excluded''::text]))'
     or to_regprocedure('public.canary_review_social_thread(uuid,uuid,text,integer,text,text)') is null
     or to_regprocedure('public.canary_bulk_review_social_threads(uuid,text,uuid[],text)') is null
     or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('social_threads','social_review_batches','social_review_events') and (not c.relrowsecurity or c.relforcerowsecurity)) then
    raise exception 'Exact pure N-1 visibility contract is absent';
  end if;
end
$guard$;

with affected_relations as (
  select c.oid,c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('social_threads','social_review_batches','social_review_events')
), contract as (
  select 'column'::text kind,c.table_name||'.'||c.column_name name,concat_ws('|',c.data_type,c.udt_name,c.is_nullable,coalesce(c.column_default,'<null>')) definition
  from information_schema.columns c where c.table_schema='public' and c.table_name in (select relname from affected_relations)
  union all select 'constraint',r.relname||'.'||con.conname,pg_get_constraintdef(con.oid,true) from pg_constraint con join affected_relations r on r.oid=con.conrelid
  union all select 'function',p.oid::regprocedure::text,pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('canary_assert_social_reviewer','canary_review_social_thread','canary_bulk_review_social_threads','prevent_social_review_audit_mutation','touch_social_updated_at')
  union all select 'trigger',r.relname||'.'||t.tgname,pg_get_triggerdef(t.oid,true) from pg_trigger t join affected_relations r on r.oid=t.tgrelid where not t.tgisinternal
  union all select 'index',i.tablename||'.'||i.indexname,i.indexdef from pg_indexes i where i.schemaname='public' and i.tablename in (select relname from affected_relations)
  union all select 'table_grant',g.table_name||':'||g.grantee||':'||g.privilege_type,concat_ws('|',g.grantor,g.is_grantable) from information_schema.role_table_grants g where g.table_schema='public' and g.table_name in (select relname from affected_relations)
  union all select 'function_grant',r.routine_name||':'||r.grantee||':'||r.privilege_type,concat_ws('|',r.grantor,r.is_grantable) from information_schema.routine_privileges r where r.routine_schema='public' and r.routine_name in ('canary_assert_social_reviewer','canary_review_social_thread','canary_bulk_review_social_threads','prevent_social_review_audit_mutation','touch_social_updated_at')
  union all select 'policy',p.tablename||'.'||p.policyname,concat_ws('|',p.permissive,array_to_string(p.roles,','),p.cmd,coalesce(p.qual,'<null>'),coalesce(p.with_check,'<null>')) from pg_policies p where p.schemaname='public' and p.tablename in (select relname from affected_relations)
  union all select 'rls',relname,concat_ws('|',relrowsecurity,relforcerowsecurity) from affected_relations
  union all select 'relation_owner',relname,pg_get_userbyid(relowner) from affected_relations
  union all select 'function_owner',p.oid::regprocedure::text,pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('canary_assert_social_reviewer','canary_review_social_thread','canary_bulk_review_social_threads','prevent_social_review_audit_mutation','touch_social_updated_at')
), object_rows as (
  select jsonb_agg(jsonb_build_object('kind',kind,'name',name,'md5',md5(definition)) order by kind,name) objects,
    md5(string_agg(kind||E'\x1f'||name||E'\x1f'||definition,E'\x1e' order by kind,name)) fingerprint from contract
), checked as (
  select *,nullif(current_setting('canary.expected_pure_n1_fingerprint',true),'') expected from object_rows
)
select jsonb_pretty(jsonb_build_object(
  'verification_identity','exact-restored-pure-n-1-non-sealing',
  'sealable',false,
  'captured_at_utc',timezone('utc',now()),
  'server_version',current_setting('server_version'),
  'pure_n1_schema_fingerprint_md5',checked.fingerprint,
  'expected_task4_object_oids',case when nullif(current_setting('canary.expected_task4_table_oid',true),'') is null then null else jsonb_build_object(
    'social_correction_requests',current_setting('canary.expected_task4_table_oid')::bigint,
    'canary_apply_social_correction',current_setting('canary.expected_task4_apply_oid')::bigint,
    'canary_ingest_social_thread',current_setting('canary.expected_task4_ingest_oid')::bigint) end,
  'objects',checked.objects
)) as social_restored_n1_verification
from checked
where checked.expected is null or checked.fingerprint=checked.expected;
rollback;
