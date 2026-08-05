-- Read-only Social N-1/N contract verifier. Safe for the verified Canary SQL Editor.
-- Optional inputs before running:
--   set canary.expected_social_state = 'N-1'; -- N or N-1
--   set canary.expected_social_rows = '1032';
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
  task4_any boolean;
  task4_complete boolean;
  task4_unexpected_relation boolean;
begin
  if to_regclass('public.social_threads') is null then raise exception 'social_threads is absent'; end if;
  with task4_relation_candidates as (
    select c.oid, c.relname
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and (
      c.relname='social_correction_requests' or (
      -- A full named/type subset remains conclusive after a relation rename or added columns.
      -- The name score catches a mutated required column; the type/constraint score catches
      -- a renamed required column without depending on relation, column, or constraint names.
      (select count(*) from pg_attribute a
       where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
         and (a.attname,a.atttypid) in (
           ('actor_user_id','uuid'::regtype),('idempotency_key','text'::regtype),
           ('request_payload','jsonb'::regtype),('result_row','jsonb'::regtype),
           ('created_at','timestamptz'::regtype),('completed_at','timestamptz'::regtype)
         ))=6
      or (select count(*) from pg_attribute a
          where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
            and a.attname in ('actor_user_id','idempotency_key','request_payload','result_row','created_at','completed_at'))>=5
      or (
        (select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.atttypid='uuid'::regtype)>=1
        and (select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.atttypid='text'::regtype)>=1
        and (select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.atttypid='jsonb'::regtype)>=2
        and (select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.atttypid='timestamptz'::regtype)>=2
        and exists (select 1 from pg_constraint con where con.conrelid=c.oid and con.contype='p' and cardinality(con.conkey)=2)
        and (select count(*) from pg_constraint con where con.conrelid=c.oid and con.contype='c')>=2
      )
      or (
        exists (select 1 from pg_constraint con where con.conrelid=c.oid and con.contype='p' and cardinality(con.conkey)=2)
        and exists (select 1 from pg_constraint con where con.conrelid=c.oid and con.contype='c'
                    and pg_get_constraintdef(con.oid,true) like '%^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$%')
        and exists (select 1 from pg_constraint con where con.conrelid=c.oid and con.contype='c'
                    and lower(pg_get_constraintdef(con.oid,true)) like '%is null%'
                    and lower(pg_get_constraintdef(con.oid,true)) like '%is not null%')
      )
    )
    )
  )
  select
    exists (select 1 from task4_relation_candidates) or exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (
        p.proname in ('canary_apply_social_correction','canary_ingest_social_thread')
        or (md5(p.prosrc)='2159589b09d094e5a9052fd399a1d3cf'
            and oidvectortypes(p.proargtypes)='uuid, text, uuid, text, integer, text')
        or (md5(p.prosrc)='89d2d1ef8f7a3ff7c26e74aeb450bd5c'
            and oidvectortypes(p.proargtypes)='jsonb')
      )
    ),
    coalesce((
      select
        c.relkind='r'
        and pg_get_userbyid(c.relowner)='postgres'
        and c.relrowsecurity
        and not c.relforcerowsecurity
        and (select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)=6
        and not exists (
          select 1
          from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
          where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
            and not coalesce((
              a.atttypmod=-1 and a.attidentity='' and a.attgenerated='' and (
                (a.attname='actor_user_id' and a.atttypid='uuid'::regtype and a.attnotnull and d.oid is null)
                or (a.attname='idempotency_key' and a.atttypid='text'::regtype and a.attnotnull and d.oid is null)
                or (a.attname='request_payload' and a.atttypid='jsonb'::regtype and a.attnotnull and d.oid is null)
                or (a.attname='result_row' and a.atttypid='jsonb'::regtype and not a.attnotnull and d.oid is null)
                or (a.attname='created_at' and a.atttypid='timestamptz'::regtype and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='now()')
                or (a.attname='completed_at' and a.atttypid='timestamptz'::regtype and not a.attnotnull and d.oid is null)
              )
            ),false)
        )
        and (select count(*) from pg_constraint con where con.conrelid=c.oid)=3
        and not exists (
          select 1 from pg_constraint con where con.conrelid=c.oid and not (
            (con.conname='social_correction_requests_pkey' and con.contype='p' and con.convalidated
              and pg_get_constraintdef(con.oid,true)='PRIMARY KEY (actor_user_id, idempotency_key)')
            or (con.conname='social_correction_requests_key_check' and con.contype='c' and con.convalidated
              and pg_get_constraintdef(con.oid,true)='CHECK (idempotency_key ~ ''^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$''::text)')
            or (con.conname='social_correction_requests_completion_check' and con.contype='c' and con.convalidated
              and pg_get_constraintdef(con.oid,true)='CHECK (completed_at IS NULL AND result_row IS NULL OR completed_at IS NOT NULL AND result_row IS NOT NULL)')
          )
        )
        and not exists (select 1 from pg_policy pol where pol.polrelid=c.oid)
        and not exists (
          select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
          where acl.grantee<>c.relowner
        )
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='social_correction_requests'
    ),false)
    and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname in ('canary_apply_social_correction','canary_ingest_social_thread'))=2
    -- Bind both RPC bodies to Task 4's migration source; catalog properties and ACLs are checked separately.
    and coalesce((
      select bool_and(
        l.lanname='plpgsql' and p.prokind='f' and p.prosecdef and not p.proisstrict
        and pg_get_userbyid(p.proowner)='postgres'
        and p.provolatile='v' and p.proparallel='u'
        -- Task 4 defines every input as required. Check both catalog representations so
        -- CREATE OR REPLACE cannot preserve the exact signature/body while adding defaults.
        and p.pronargdefaults=0 and p.proargdefaults is null
        and p.prorettype='public.social_threads'::regtype
        and p.proconfig=ARRAY['search_path=pg_catalog, public']
        and (
          (p.proname='canary_apply_social_correction'
            and oidvectortypes(p.proargtypes)='uuid, text, uuid, text, integer, text'
            and p.proargnames=ARRAY['p_actor_user_id','p_expected_district_id','p_social_thread_id','p_action','p_expected_version','p_idempotency_key']
            and md5(p.prosrc)='2159589b09d094e5a9052fd399a1d3cf')
          or (p.proname='canary_ingest_social_thread'
            and oidvectortypes(p.proargtypes)='jsonb'
            and p.proargnames=ARRAY['p_thread']
            and md5(p.prosrc)='89d2d1ef8f7a3ff7c26e74aeb450bd5c')
        )
        and (select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
             where acl.grantee<>p.proowner)=1
        and exists (
          select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
          where acl.grantee<>p.proowner and acl.grantee<>0
            and pg_get_userbyid(acl.grantee)='service_role'
            and acl.privilege_type='EXECUTE' and not acl.is_grantable
        )
      )
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
      where n.nspname='public' and p.proname in ('canary_apply_social_correction','canary_ingest_social_thread')
    ),false),
    exists (select 1 from task4_relation_candidates where relname<>'social_correction_requests')
  into task4_any,task4_complete,task4_unexpected_relation;
  perform set_config('canary.verified_task4_any',task4_any::text,true);
  perform set_config('canary.verified_task4_complete',task4_complete::text,true);
  if expected_state is null and ((task4_any and not task4_complete) or task4_unexpected_relation) then
    raise exception 'Social Task 4 structural contract verification failed';
  end if;
  select pg_get_expr(d.adbin, d.adrelid) into actual_default
  from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='public.social_threads'::regclass and a.attname='visibility_status';
  select pg_get_constraintdef(c.oid, true) into actual_check from pg_constraint c
  where c.conrelid='public.social_threads'::regclass and c.conname='social_threads_visibility_status_check';
  if expected_state = 'N' then
    if actual_default is null or actual_default not in ('''active''::text','''active''')
       or actual_check is distinct from 'CHECK (visibility_status = ANY (ARRAY[''active''::text, ''excluded''::text]))'
       or exists(select 1 from public.social_threads where visibility_status not in ('active','excluded'))
       or not task4_complete
       or task4_unexpected_relation
       or to_regprocedure('public.canary_review_social_thread(uuid,uuid,text,integer,text,text)') is not null
       or to_regprocedure('public.canary_bulk_review_social_threads(uuid,text,uuid[],text)') is not null then
      raise exception 'Social N contract verification failed';
    end if;
  elsif expected_state = 'N-1' then
    if actual_default is null or actual_default not in ('''review''::text','''review''')
       or actual_check is distinct from 'CHECK (visibility_status = ANY (ARRAY[''review''::text, ''approved''::text, ''active''::text, ''excluded''::text]))'
       or to_regprocedure('public.canary_review_social_thread(uuid,uuid,text,integer,text,text)') is null
       or to_regprocedure('public.canary_bulk_review_social_threads(uuid,text,uuid[],text)') is null
       or (task4_any and not task4_complete)
       or task4_unexpected_relation then
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

with task4_relation_candidates as (
  select c.oid
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and (
    c.relname='social_correction_requests' or (
    (select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
     and (a.attname,a.atttypid) in (
       ('actor_user_id','uuid'::regtype),('idempotency_key','text'::regtype),
       ('request_payload','jsonb'::regtype),('result_row','jsonb'::regtype),
       ('created_at','timestamptz'::regtype),('completed_at','timestamptz'::regtype)
     ))=6
    or (select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
        and a.attname in ('actor_user_id','idempotency_key','request_payload','result_row','created_at','completed_at'))>=5
    or (
      (select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.atttypid='uuid'::regtype)>=1
      and (select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.atttypid='text'::regtype)>=1
      and (select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.atttypid='jsonb'::regtype)>=2
      and (select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.atttypid='timestamptz'::regtype)>=2
      and exists (select 1 from pg_constraint con where con.conrelid=c.oid and con.contype='p' and cardinality(con.conkey)=2)
      and (select count(*) from pg_constraint con where con.conrelid=c.oid and con.contype='c')>=2
    )
    or (
      exists (select 1 from pg_constraint con where con.conrelid=c.oid and con.contype='p' and cardinality(con.conkey)=2)
      and exists (select 1 from pg_constraint con where con.conrelid=c.oid and con.contype='c'
                  and pg_get_constraintdef(con.oid,true) like '%^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$%')
      and exists (select 1 from pg_constraint con where con.conrelid=c.oid and con.contype='c'
                  and lower(pg_get_constraintdef(con.oid,true)) like '%is null%'
                  and lower(pg_get_constraintdef(con.oid,true)) like '%is not null%')
    )
  )
  )
), affected_relations as (
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and (
    c.relname in ('social_threads','social_review_batches','social_review_events','social_correction_requests')
    or c.oid in (select oid from task4_relation_candidates)
  )
), contract as (
  select 'column'::text kind, c.table_name||'.'||c.column_name name,
    concat_ws('|',c.data_type,c.udt_name,c.is_nullable,coalesce(c.column_default,'<null>')) definition
  from information_schema.columns c
  where c.table_schema='public' and c.table_name in (select relname from affected_relations)
  union all
  select 'constraint', r.relname||'.'||con.conname, pg_get_constraintdef(con.oid,true)
  from pg_constraint con join affected_relations r on r.oid=con.conrelid
  union all
  select 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (
    p.proname in ('canary_assert_social_reviewer','canary_review_social_thread','canary_bulk_review_social_threads',
      'canary_apply_social_correction','canary_ingest_social_thread','prevent_social_review_audit_mutation','touch_social_updated_at')
    or (md5(p.prosrc)='2159589b09d094e5a9052fd399a1d3cf'
        and oidvectortypes(p.proargtypes)='uuid, text, uuid, text, integer, text')
    or (md5(p.prosrc)='89d2d1ef8f7a3ff7c26e74aeb450bd5c'
        and oidvectortypes(p.proargtypes)='jsonb')
  )
  union all
  select 'trigger', r.relname||'.'||t.tgname, pg_get_triggerdef(t.oid,true)
  from pg_trigger t join affected_relations r on r.oid=t.tgrelid where not t.tgisinternal
  union all
  select 'index', i.tablename||'.'||i.indexname, i.indexdef
  from pg_indexes i where i.schemaname='public' and i.tablename in (select relname from affected_relations)
  union all
  select 'table_grant', g.table_name||':'||g.grantee||':'||g.privilege_type,
    concat_ws('|',g.grantor,g.is_grantable)
  from information_schema.role_table_grants g where g.table_schema='public'
    and g.table_name in (select relname from affected_relations)
  union all
  select 'function_grant', r.routine_name||':'||r.grantee||':'||r.privilege_type,
    concat_ws('|',r.grantor,r.is_grantable)
  from information_schema.routine_privileges r where r.routine_schema='public' and (
    r.routine_name in ('canary_assert_social_reviewer','canary_review_social_thread','canary_bulk_review_social_threads',
      'canary_apply_social_correction','canary_ingest_social_thread')
    or r.routine_name in (
      select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (
        (md5(p.prosrc)='2159589b09d094e5a9052fd399a1d3cf'
          and oidvectortypes(p.proargtypes)='uuid, text, uuid, text, integer, text')
        or (md5(p.prosrc)='89d2d1ef8f7a3ff7c26e74aeb450bd5c'
          and oidvectortypes(p.proargtypes)='jsonb')
      )
    )
  )
  union all
  select 'policy', p.tablename||'.'||p.policyname,
    concat_ws('|',p.permissive,array_to_string(p.roles,','),p.cmd,coalesce(p.qual,'<null>'),coalesce(p.with_check,'<null>'))
  from pg_policies p where p.schemaname='public' and p.tablename in (select relname from affected_relations)
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
), schema_state as (
  select
    (select pg_get_expr(d.adbin,d.adrelid)
     from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
     where a.attrelid='public.social_threads'::regclass and a.attname='visibility_status') visibility_default,
    (select pg_get_constraintdef(c.oid,true)
     from pg_constraint c
     where c.conrelid='public.social_threads'::regclass and c.conname='social_threads_visibility_status_check') visibility_check,
    current_setting('canary.verified_task4_any')::boolean task4_any,
    current_setting('canary.verified_task4_complete')::boolean task4_complete,
    to_regprocedure('public.canary_review_social_thread(uuid,uuid,text,integer,text,text)') is not null legacy_review_present,
    to_regprocedure('public.canary_bulk_review_social_threads(uuid,text,uuid[],text)') is not null legacy_bulk_review_present
), object_rows as (
  select jsonb_agg(jsonb_build_object('kind',kind,'name',name,'md5',md5(definition)) order by kind,name) objects,
         md5(string_agg(kind||E'\x1f'||name||E'\x1f'||definition,E'\x1e' order by kind,name)) fingerprint
  from contract
)
select jsonb_pretty(jsonb_build_object(
  'captured_at_utc',timezone('utc',now()),'server_version',current_setting('server_version'),
  'schema_identity','canary-social-visibility-v2','schema_fingerprint_md5',object_rows.fingerprint,
  'migration_state_identity',case
    when schema_state.visibility_default in ('''active''::text','''active''')
      and schema_state.visibility_check = 'CHECK (visibility_status = ANY (ARRAY[''active''::text, ''excluded''::text]))'
      and schema_state.task4_complete
      and not schema_state.legacy_review_present
      and not schema_state.legacy_bulk_review_present then 'task5-n'
    when schema_state.visibility_default in ('''review''::text','''review''')
      and schema_state.visibility_check = 'CHECK (visibility_status = ANY (ARRAY[''review''::text, ''approved''::text, ''active''::text, ''excluded''::text]))'
      and schema_state.legacy_review_present
      and schema_state.legacy_bulk_review_present
      and schema_state.task4_complete then 'task5-n-1'
    when schema_state.visibility_default in ('''review''::text','''review''')
      and schema_state.visibility_check = 'CHECK (visibility_status = ANY (ARRAY[''review''::text, ''approved''::text, ''active''::text, ''excluded''::text]))'
      and schema_state.legacy_review_present
      and schema_state.legacy_bulk_review_present
      and not schema_state.task4_any then 'task5-restored-n-1'
    else 'unknown' end,
  'objects',object_rows.objects,'row_count',(select count(*) from public.social_threads),
  'exclusion_count',(select count(*) from public.social_threads where visibility_status='excluded'),
  'status_counts',status_counts.value,'status_relationship_counts',relationship_counts.value,
  'official_report_set_count',(select count(*) from official_set),
  'official_report_set_md5',(select md5(coalesce(string_agg(id::text,',' order by id),'')) from official_set),
  'review_version_min',(select min(review_version) from public.social_threads),
  'review_version_max',(select max(review_version) from public.social_threads),
  'review_version_nulls',(select count(*) from public.social_threads where review_version is null)
)) as social_visibility_contract
from object_rows,status_counts,relationship_counts,schema_state;
rollback;
