#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root=new URL('..',import.meta.url).pathname;
const image='postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const container=`canary-social-migration-${process.pid}-${randomBytes(3).toString('hex')}`;
const temp=await mkdtemp(join(tmpdir(),'canary-social-migration-'));
const run=(command,args,options={})=>{const result=spawnSync(command,args,{encoding:'utf8',...options});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed (${result.status}): ${result.stderr||result.stdout}`);return result.stdout;};
const psql=(sql,ok=true)=>{const result=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:sql,encoding:'utf8',maxBuffer:128*1024*1024});if(ok&&result.status!==0)throw new Error(result.stderr);if(!ok&&result.status===0)throw new Error('Expected SQL failure');return result;};
const file=async(path)=>readFile(join(root,path),'utf8');
const node=(script,args,ok=true)=>{const result=spawnSync(process.execPath,[join(root,script),...args],{encoding:'utf8',maxBuffer:128*1024*1024});if(ok&&result.status!==0)throw new Error(result.stderr||result.stdout);if(!ok&&result.status===0)throw new Error(`Expected ${script} failure`);return result;};
const parseJson=(text)=>JSON.parse(text.trim());
const csv=(header,value)=>`${header}\r\n"${JSON.stringify(value).replaceAll('"','""')}"\r\n`;
const canonicalJson=(value)=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonicalJson).join(',')}]`:`{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
const sha256=(value)=>createHash('sha256').update(value).digest('hex');
const reseal=(artifact)=>{artifact.manifest.artifactSha256=null;artifact.manifest.artifactSha256=sha256(canonicalJson(artifact));return artifact;};
let started=false;
try{
 run('docker',['run','--detach','--rm','--name',container,'--mount','type=tmpfs,destination=/var/lib/postgresql/data,tmpfs-size=536870912','-e','POSTGRES_PASSWORD=test-only',image]);started=true;
 for(let i=0,consecutiveReady=0;i<60;i+=1){const ready=spawnSync('docker',['exec',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-c','select 1'],{encoding:'utf8'});consecutiveReady=ready.status===0?consecutiveReady+1:0;if(consecutiveReady>=2)break;await new Promise((resolve)=>setTimeout(resolve,250));if(i===59)throw new Error(`PostgreSQL not ready: ${ready.stderr}`);}
 const [fixture,capturedN1,task4,forward,down,verify,verifyRestored,captureEvidenceSql]=await Promise.all([
  file('scripts/fixtures/social-n1.sql'),file('scripts/fixtures/social-n1-production-captured.sql'),file('supabase/migrations/20260804193000_social_visibility_lifecycle.sql'),file('supabase/migrations/20260805120000_social_visibility_active.sql'),file('supabase/rollbacks/20260805120000_social_visibility_active_down.sql'),file('supabase/verify_social_visibility_contract.sql'),file('supabase/verify_social_restored_n1.sql'),file('supabase/capture_social_rollback_evidence_readonly.sql')]);
 psql(fixture);psql(capturedN1);
 const expectedFunctionMd5={canary_assert_social_reviewer:'f8acecd019a7182f9394ca2ce1d78a67',canary_bulk_review_social_threads:'8bd52d87cc68594f993f0e8f4b7c29bb',canary_review_social_thread:'c4f851bf607f11545d47ef2b04b29740',prevent_social_review_audit_mutation:'7f325916f94da40cbf15014e320345d6',touch_social_updated_at:'feff1b4a6c026311cd0a6164d5f96a65'};
 const functionMd5=()=>parseJson(psql(`select jsonb_object_agg(proname,definition_md5 order by proname) from (select p.proname,md5(pg_get_functiondef(p.oid)) definition_md5 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['canary_assert_social_reviewer','canary_bulk_review_social_threads','canary_review_social_thread','prevent_social_review_audit_mutation','touch_social_updated_at'])) x;`).stdout);
 assert.deepEqual(functionMd5(),expectedFunctionMd5);
 psql(`insert into public.social_threads(id,district_id,social_account_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at,visibility_status,review_version,reviewed_at,reviewed_by,created_at,updated_at) values
 ('50000000-0000-0000-0000-000000000001','district-a','11111111-1111-1111-1111-111111111111','meta','facebook','a-review-owned','https://x/1','owned','2026-08-01Z','review',0,null,null,'2026-08-01Z','2026-08-01Z'),
 ('50000000-0000-0000-0000-000000000002','district-a',null,'meta','facebook','a-approved-tag','https://x/2','direct_tag','2026-08-01Z','approved',1,'2026-08-02Z','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','2026-08-01Z','2026-08-02Z'),
 ('50000000-0000-0000-0000-000000000003','district-a',null,'meta','facebook','a-active-mention','https://x/3','direct_mention','2026-08-01Z','active',2,null,null,'2026-08-01Z','2026-08-01Z'),
 ('50000000-0000-0000-0000-000000000004','district-a',null,'meta','facebook','a-excluded-ambient','https://x/4','ambient','2026-08-01Z','excluded',3,null,null,'2026-08-01Z','2026-08-01Z'),
 ('50000000-0000-0000-0000-000000000005','district-b','22222222-2222-2222-2222-222222222222','meta','facebook','b-review-owned','https://x/5','owned','2026-08-01Z','review',4,null,null,'2026-08-01Z','2026-08-01Z'),
 ('50000000-0000-0000-0000-000000000006','district-b',null,'meta','facebook','b-review-ambient','https://x/6','ambient','2026-08-01Z','review',0,null,null,'2026-08-01Z','2026-08-01Z');`);
 const pureSeal=psql(`set canary.expected_social_state='N-1';${verify}`,false);
 assert.match(pureSeal.stderr,/requires complete exact Task 4 additive objects/i);
 const pureN1=parseJson(psql(verifyRestored).stdout);
 assert.equal(pureN1.verification_identity,'exact-restored-pure-n-1-non-sealing');
 assert.equal(pureN1.sealable,false);
 await writeFile(join(temp,'pure-n1.csv'),csv('social_restored_n1_verification',pureN1));
 node('scripts/verify-social-restored-n1.mjs',['--capture-baseline-input',join(temp,'pure-n1.csv'),'--output',join(temp,'pure-n1-baseline.json')]);
 psql(forward,false);psql(task4);
 const n1Raw=psql(`set canary.expected_social_state='N-1';set canary.expected_social_rows='6';set canary.expected_social_exclusions='1';${verify}`).stdout;
 const n1=parseJson(n1Raw);
 assert.equal(n1.migration_state_identity,'task5-n-1');
 assert.notEqual(n1.schema_fingerprint_md5,pureN1.schema_fingerprint_md5);
 assert.ok(n1.objects.some(({kind,name})=>kind==='column'&&name==='social_correction_requests.actor_user_id'));
 assert.ok(n1.objects.some(({kind,name})=>kind==='function'&&name==='canary_apply_social_correction(uuid,text,uuid,text,integer,text)'));
 assert.ok(n1.objects.some(({kind,name})=>kind==='function'&&name==='canary_ingest_social_thread(jsonb)'));
 assert.ok(n1.objects.some(({kind,name})=>kind==='relation_owner'&&name==='social_threads'));
 assert.ok(n1.objects.some(({kind,name})=>kind==='relation_owner'&&name==='social_correction_requests'));
 assert.ok(n1.objects.some(({kind,name})=>kind==='function_owner'&&name==='canary_assert_social_reviewer(uuid)'));
 assert.ok(n1.objects.some(({kind,name})=>kind==='function_owner'&&name==='canary_apply_social_correction(uuid,text,uuid,text,integer,text)'));
 assert.ok(Number.isSafeInteger(n1.task4_object_oids.social_correction_requests));
 await writeFile(join(temp,'n1-raw.txt'),n1Raw);
 await writeFile(join(temp,'n1.csv'),csv('social_visibility_contract',n1));
 node('scripts/capture-social-schema-contract.mjs',['--input',join(temp,'n1.csv'),'--output',join(temp,'n1-contract.json')]);
 const contract=JSON.parse(await readFile(join(temp,'n1-contract.json'),'utf8'));
 assert.equal(contract.toolVersion,'2.1.0');assert.equal(contract.migrationStateIdentity,'task5-n-1');assert.equal(contract.contract.schema_fingerprint_md5,n1.schema_fingerprint_md5);
 node('scripts/verify-social-restored-n1.mjs',['--baseline-artifact',join(temp,'pure-n1-baseline.json'),'--additive-contract',join(temp,'n1-contract.json'),'--sql-output',join(temp,'verify-restored.sql')]);
 const boundRestoredVerify=await readFile(join(temp,'verify-restored.sql'),'utf8');
 const verifyMutationFails=(mutation,state='N-1')=>{
  const result=psql(`begin;${mutation};set canary.expected_social_state='${state}';set canary.expected_social_rows='6';set canary.expected_social_exclusions='1';${verify}`,false);
  assert.match(result.stderr,new RegExp(`Social ${state} contract verification failed|requires complete exact Task 4 additive objects|ownership differs from exact postgres baseline`));
 };
 const psqlDb=(database,sql,ok=true)=>{const result=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input:sql,encoding:'utf8',maxBuffer:128*1024*1024});if(ok&&result.status!==0)throw new Error(result.stderr);if(!ok&&result.status===0)throw new Error('Expected SQL failure');return result;};
 const duplicateDatabase=(label,setup,expectedFresh,state='N-1',verifyRestoredRemnant=false)=>{
  const database=`task4_${label}_${process.pid}`;
  run('docker',['exec',container,'createdb','-U','postgres','-T','postgres',database]);
  try{
   const original=parseJson(psqlDb(database,"select jsonb_build_object('table','public.social_correction_requests'::regclass::oid,'apply','public.canary_apply_social_correction(uuid,text,uuid,text,integer,text)'::regprocedure::oid,'ingest','public.canary_ingest_social_thread(jsonb)'::regprocedure::oid);").stdout);
   psqlDb(database,setup);
   const replacement=parseJson(psqlDb(database,"select jsonb_build_object('table',to_regclass('public.social_correction_requests')::oid,'apply',to_regprocedure('public.canary_apply_social_correction(uuid,text,uuid,text,integer,text)')::oid,'ingest',to_regprocedure('public.canary_ingest_social_thread(jsonb)')::oid);").stdout);
   for(const kind of ['table','apply','ingest']){
    assert.notEqual(replacement[kind],null);
    if(expectedFresh.includes(kind))assert.notEqual(replacement[kind],original[kind],`${label} must create a fresh canonical ${kind} OID`);
    else assert.equal(replacement[kind],original[kind],`${label} must retain the canonical ${kind} OID`);
   }
   const result=psqlDb(database,`set canary.expected_social_state='${state}';set canary.expected_social_rows='6';set canary.expected_social_exclusions='1';${verify}`,false);
   assert.match(result.stderr,/requires complete exact Task 4 additive objects/i);
   if(verifyRestoredRemnant){
    const restoredResult=psqlDb(database,`drop function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text);drop function public.canary_ingest_social_thread(jsonb);drop table public.social_correction_requests;${verifyRestored}`,false);
    assert.match(restoredResult.stderr,/Task 4 table candidates remain in restored N-1/i);
   }
  }finally{run('docker',['exec',container,'dropdb','-U','postgres','--force',database]);}
 };
 const task4Table=task4.slice(task4.indexOf('create table public.social_correction_requests'),task4.indexOf('create or replace function public.canary_apply_social_correction'));
 const task4Functions=task4.slice(task4.indexOf('create or replace function public.canary_apply_social_correction'),task4.indexOf('revoke all on function public.canary_apply_social_correction'));
 const task4Grants=task4.slice(task4.indexOf('revoke all on function public.canary_apply_social_correction'),task4.indexOf('commit;'));
 duplicateDatabase('functions',`alter function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text) rename to archived_task4_apply;
   alter function public.canary_ingest_social_thread(jsonb) rename to archived_task4_ingest;
   ${task4Functions}${task4Grants}`,['apply','ingest']);
 duplicateDatabase('apply_function',`alter function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text) rename to archived_task4_apply;
   ${task4Functions}${task4Grants}`,['apply']);
 duplicateDatabase('ingest_function',`alter function public.canary_ingest_social_thread(jsonb) rename to archived_task4_ingest;
   ${task4Functions}${task4Grants}`,['ingest']);
 duplicateDatabase('table',`alter table public.social_correction_requests rename to archived_task4_requests;
   alter table public.archived_task4_requests rename constraint social_correction_requests_pkey to archived_task4_requests_pkey;
   alter table public.archived_task4_requests rename constraint social_correction_requests_key_check to archived_task4_requests_key_check;
   alter table public.archived_task4_requests rename constraint social_correction_requests_completion_check to archived_task4_requests_completion_check;
   ${task4Table}`,['table']);
 duplicateDatabase('near_table',`create table public.archived_task4_near
   (like public.social_correction_requests including defaults including constraints);
   alter table public.archived_task4_near add column remnant_marker text`,[]);
 const archiveAndRecreate=`alter table public.social_correction_requests rename to archived_task4_requests;
   alter table public.archived_task4_requests rename constraint social_correction_requests_pkey to archived_task4_requests_pkey;
   alter table public.archived_task4_requests rename constraint social_correction_requests_key_check to archived_task4_requests_key_check;
   alter table public.archived_task4_requests rename constraint social_correction_requests_completion_check to archived_task4_requests_completion_check;
   alter function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text) rename to archived_task4_apply;
   alter function public.canary_ingest_social_thread(jsonb) rename to archived_task4_ingest;
   ${task4}`;
 duplicateDatabase('complete_n1',archiveAndRecreate,['table','apply','ingest']);
 const reviewRepro=`alter table public.social_correction_requests rename to archived_task4_review_repro;
   alter table public.archived_task4_review_repro rename constraint social_correction_requests_pkey to archived_task4_review_repro_pkey;
   alter table public.archived_task4_review_repro rename constraint social_correction_requests_key_check to archived_task4_review_repro_key_check;
   alter table public.archived_task4_review_repro rename constraint social_correction_requests_completion_check to archived_task4_review_repro_completion_check;
   alter table public.archived_task4_review_repro rename column result_row to archived_result_row;
   alter table public.archived_task4_review_repro add column remnant_marker text;
   drop function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text);
   drop function public.canary_ingest_social_thread(jsonb);
   ${task4}`;
 duplicateDatabase('review_repro',reviewRepro,['table','apply','ingest'],'N-1',true);
 const renamedSignatureRepro=`alter table public.social_correction_requests rename to archived_task4_renamed_signature;
   alter table public.archived_task4_renamed_signature rename column actor_user_id to archived_actor;
   alter table public.archived_task4_renamed_signature rename column idempotency_key to archived_key;
   alter table public.archived_task4_renamed_signature rename column request_payload to archived_payload;
   alter table public.archived_task4_renamed_signature rename column result_row to archived_result;
   alter table public.archived_task4_renamed_signature add column remnant_marker boolean;
   drop function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text);
   drop function public.canary_ingest_social_thread(jsonb);
   ${task4}`;
 duplicateDatabase('renamed_signature',renamedSignatureRepro,['table','apply','ingest'],'N-1',true);
 const functionDefinition=(signature)=>psql(`select pg_get_functiondef('${signature}'::regprocedure);`).stdout;
 const correctionDefaultDefinition=functionDefinition('public.canary_apply_social_correction(uuid,text,uuid,text,integer,text)').replace('p_idempotency_key text','p_idempotency_key text DEFAULT \'default-key\'::text');
 const ingestionDefaultDefinition=functionDefinition('public.canary_ingest_social_thread(jsonb)').replace('p_thread jsonb','p_thread jsonb DEFAULT \'{}\'::jsonb');
 assert.match(correctionDefaultDefinition,/p_idempotency_key text DEFAULT/);
 assert.match(ingestionDefaultDefinition,/p_thread jsonb DEFAULT/);
 verifyMutationFails(correctionDefaultDefinition);
 verifyMutationFails(ingestionDefaultDefinition);
 verifyMutationFails(`create function public.canary_ingest_social_thread(p_thread text default 'malformed') returns public.social_threads language plpgsql security definer set search_path=pg_catalog,public as $malformed$ begin raise exception 'malformed'; end $malformed$`);
 verifyMutationFails('drop function public.canary_ingest_social_thread(jsonb)');
 assert.equal(psql("select to_regprocedure('public.canary_ingest_social_thread(jsonb)') is not null;").stdout.trim(),'t');
 verifyMutationFails('alter table public.social_correction_requests drop constraint social_correction_requests_completion_check');
 verifyMutationFails('alter table public.social_correction_requests drop constraint social_correction_requests_completion_check;alter table public.social_correction_requests add constraint social_correction_requests_completion_check check ((completed_at is null and result_row is null) or (completed_at is not null and result_row is not null)) not valid');
 verifyMutationFails('alter table public.social_correction_requests drop constraint social_correction_requests_key_check');
 verifyMutationFails('alter table public.social_correction_requests drop constraint social_correction_requests_pkey cascade');
 verifyMutationFails('alter table public.social_correction_requests drop column result_row cascade');
 verifyMutationFails('alter table public.social_correction_requests alter column created_at drop default');
 verifyMutationFails('alter table public.social_correction_requests alter column completed_at type timestamptz(3)');
 verifyMutationFails('alter table public.social_correction_requests alter column request_payload drop not null');
 verifyMutationFails('alter table public.social_correction_requests disable row level security');
 verifyMutationFails('alter table public.social_correction_requests force row level security');
 verifyMutationFails('alter table public.social_correction_requests owner to authenticated');
 verifyMutationFails('alter table public.social_threads owner to authenticated');
 verifyMutationFails('alter function public.canary_assert_social_reviewer(uuid) owner to authenticated');
 verifyMutationFails('alter function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text) owner to authenticated');
 verifyMutationFails('alter function public.canary_ingest_social_thread(jsonb) owner to authenticated');
 verifyMutationFails("create policy correction_requests_leak on public.social_correction_requests for select to authenticated using (true)");
 verifyMutationFails('grant select on public.social_correction_requests to authenticated');
 verifyMutationFails('grant select on public.social_correction_requests to service_role');
 verifyMutationFails('grant select on public.social_correction_requests to service_role with grant option');
 verifyMutationFails('grant execute on function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text) to authenticated');
 verifyMutationFails('revoke execute on function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text) from service_role');
 verifyMutationFails('grant execute on function public.canary_ingest_social_thread(jsonb) to service_role with grant option');
 verifyMutationFails('alter function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text) security invoker');
 verifyMutationFails('alter function public.canary_ingest_social_thread(jsonb) set search_path=public');
 verifyMutationFails(`create or replace function public.canary_ingest_social_thread(p_thread jsonb) returns public.social_threads language plpgsql security definer set search_path=pg_catalog,public as $malformed$ begin raise exception 'malformed'; end $malformed$`);
 verifyMutationFails(`drop function public.canary_ingest_social_thread(jsonb);create function public.canary_ingest_social_thread(p_thread text) returns public.social_threads language plpgsql security definer set search_path=pg_catalog,public as $malformed$ begin raise exception 'malformed'; end $malformed$`);
 verifyMutationFails(`alter table public.social_correction_requests rename to social_correction_requests_hidden;
   alter table public.social_correction_requests_hidden add column remnant_marker text;
   alter table public.social_correction_requests_hidden rename constraint social_correction_requests_pkey to correction_requests_hidden_pkey;
   alter table public.social_correction_requests_hidden rename constraint social_correction_requests_key_check to correction_requests_hidden_key_check;
   alter table public.social_correction_requests_hidden rename constraint social_correction_requests_completion_check to correction_requests_hidden_completion_check;
   alter function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text) rename to canary_apply_social_correction_hidden;
   alter function public.canary_ingest_social_thread(jsonb) rename to canary_ingest_social_thread_hidden`);
 verifyMutationFails(`alter table public.social_correction_requests rename to social_correction_requests_renamed_column;
   alter table public.social_correction_requests_renamed_column rename column result_row to archived_result;
   alter table public.social_correction_requests_renamed_column add column remnant_marker integer;
   drop function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text);
   drop function public.canary_ingest_social_thread(jsonb)`);
 verifyMutationFails(`alter table public.social_correction_requests rename to social_correction_requests_mutated_column;
   alter table public.social_correction_requests_mutated_column alter column result_row type json using result_row::json;
   alter table public.social_correction_requests_mutated_column add column remnant_marker boolean;
   drop function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text);
   drop function public.canary_ingest_social_thread(jsonb)`);
 verifyMutationFails(`alter table public.social_correction_requests rename to social_correction_requests_missing_column;
   alter table public.social_correction_requests_missing_column drop column result_row cascade;
   alter table public.social_correction_requests_missing_column add column remnant_marker text;
   drop function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text);
   drop function public.canary_ingest_social_thread(jsonb)`);
 const latestBypass=`alter table public.social_correction_requests rename to arbitrary_archive;
   alter table public.arbitrary_archive rename column actor_user_id to archived_actor;
   alter table public.arbitrary_archive rename column idempotency_key to archived_key;
   alter table public.arbitrary_archive rename column request_payload to archived_payload;
   alter table public.arbitrary_archive rename column result_row to archived_result;
   alter table public.arbitrary_archive drop constraint social_correction_requests_key_check;
   alter table public.arbitrary_archive drop constraint social_correction_requests_completion_check;
   alter table public.arbitrary_archive alter column archived_result type json using archived_result::json;
   alter function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text) rename to arbitrary_apply_archive;
   drop function public.canary_ingest_social_thread(jsonb)`;
 verifyMutationFails(latestBypass);
 const restoredBypass=psql(`begin;${latestBypass};${boundRestoredVerify}`,false);
 assert.match(restoredBypass.stderr,/Captured Task 4 object OIDs still exist/i);
 const unscopedMalformed=psql(`begin;alter table public.social_correction_requests drop constraint social_correction_requests_completion_check;${verify}`,false);
 assert.match(unscopedMalformed.stderr,/requires complete exact Task 4 additive objects/);

 const rows=parseJson(psql(`select jsonb_build_object('watermark','2026-08-05T12:00:00.000000Z','rows',jsonb_agg(jsonb_build_object('id',id::text,'district_id',district_id,'relationship_type',relationship_type,'visibility_status',visibility_status,'review_version',review_version,'reviewed_at',case when reviewed_at is null then null else to_char(reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'reviewed_by',reviewed_by::text,'created_at',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by id)) from public.social_threads;`).stdout);
 await writeFile(join(temp,'rows.csv'),csv('social_visibility_backup',rows));
 const pureBackup=node('scripts/backup-social-visibility.mjs',['--input',join(temp,'rows.csv'),'--schema-contract',join(temp,'pure-n1-baseline.json'),'--output',join(temp,'pure-n1-backup.json')],false);
 assert.match(pureBackup.stderr,/schema contract|unsupported/i);
 node('scripts/backup-social-visibility.mjs',['--input',join(temp,'rows.csv'),'--schema-contract',join(temp,'n1-contract.json'),'--output',join(temp,'backup.json')]);
 const backup=JSON.parse(await readFile(join(temp,'backup.json'),'utf8'));
 assert.equal(backup.manifest.verificationMode,'production-sealed-schema-contract');assert.equal(backup.manifest.schemaContractArtifactSha256,contract.artifactSha256);assert.equal(backup.manifest.rowCount,6);assert.equal(backup.manifest.expectedRowCount,6);
 assert.equal((await stat(join(temp,'backup.json'))).mode&0o777,0o600);
 const unsafe=node('scripts/backup-social-visibility.mjs',['--input',join(temp,'rows.csv'),'--schema-identity',n1.schema_identity,'--schema-fingerprint',n1.schema_fingerprint_md5,'--expected-row-count','6','--output',join(temp,'unsafe.json')],false);
 assert.match(unsafe.stderr,/unsafe-dev-schema-assertions/i);
 node('scripts/backup-social-visibility.mjs',['--input',join(temp,'rows.csv'),'--schema-identity',n1.schema_identity,'--schema-fingerprint',n1.schema_fingerprint_md5,'--expected-row-count','6','--unsafe-dev-schema-assertions','--output',join(temp,'unsafe.json')]);
 assert.equal(JSON.parse(await readFile(join(temp,'unsafe.json'),'utf8')).manifest.verificationMode,'unsafe-development-only');
 psql(forward);psql(forward);const officialBefore=n1.official_report_set_md5;
 const n=parseJson(psql(`set canary.expected_social_state='N';set canary.expected_social_rows='6';set canary.expected_social_exclusions='1';${verify}`).stdout);
 assert.deepEqual(n.status_counts,{active:5,excluded:1});assert.equal(n.official_report_set_md5,officialBefore);assert.equal(n.migration_state_identity,'task5-n');
 duplicateDatabase('complete_n',archiveAndRecreate,['table','apply','ingest'],'N');
 verifyMutationFails(correctionDefaultDefinition,'N');
 verifyMutationFails(ingestionDefaultDefinition,'N');
 verifyMutationFails('alter table public.social_correction_requests disable row level security','N');
 verifyMutationFails('alter table public.social_correction_requests owner to authenticated','N');
 verifyMutationFails('alter table public.social_threads owner to authenticated','N');
 verifyMutationFails('alter function public.canary_assert_social_reviewer(uuid) owner to authenticated','N');
 verifyMutationFails('alter function public.canary_ingest_social_thread(jsonb) owner to authenticated','N');
 verifyMutationFails('grant select on public.social_correction_requests to service_role','N');
 verifyMutationFails('revoke execute on function public.canary_ingest_social_thread(jsonb) from service_role','N');
 verifyMutationFails('grant execute on function public.canary_ingest_social_thread(jsonb) to service_role with grant option','N');
 verifyMutationFails(`create or replace function public.canary_apply_social_correction(p_actor_user_id uuid,p_expected_district_id text,p_social_thread_id uuid,p_action text,p_expected_version integer,p_idempotency_key text) returns public.social_threads language plpgsql security definer set search_path=pg_catalog,public as $malformed$ begin raise exception 'malformed'; end $malformed$`,'N');
 await writeFile(join(temp,'n-contract-input.csv'),csv('social_visibility_contract',n));
 node('scripts/capture-social-schema-contract.mjs',['--input',join(temp,'n-contract-input.csv'),'--output',join(temp,'n-contract.json')]);
 const wrongIdentity=node('scripts/backup-social-visibility.mjs',['--input',join(temp,'rows.csv'),'--schema-contract',join(temp,'n-contract.json'),'--output',join(temp,'n-backup.json')],false);
 assert.match(wrongIdentity.stderr,/task5-n-1/i);
 psql("select (public.canary_apply_social_correction('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','district-a','50000000-0000-0000-0000-000000000001','exclude',0,'pre-watermark-correction-01')).id;");
 psql(`select (public.canary_ingest_social_thread(to_jsonb(t) || jsonb_build_object(
   'headline','refreshed backed headline','body','refreshed backed body','comment_count',42,
   'provider_metadata',jsonb_build_object('refresh','task5-routine')))).id
   from public.social_threads t where t.id='50000000-0000-0000-0000-000000000002';`);
 const activeId=psql("insert into public.social_threads(district_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at,created_at,updated_at) values('district-b','meta','facebook','real-active','https://x/new','ambient','2026-08-05T13:00:00Z','2026-08-05T13:00:00Z','2026-08-05T13:00:00Z') returning id;").stdout.trim();
 const excludedId=psql("insert into public.social_threads(district_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at,created_at,updated_at) values('district-b','meta','facebook','real-excluded','https://x/excluded','ambient','2026-08-05T13:01:00Z','2026-08-05T13:01:00Z','2026-08-05T13:01:00Z') returning id;").stdout.trim();
 psql(`select (public.canary_apply_social_correction('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','district-b','${excludedId}','exclude',0,'rollback-proof-01')).id;`);
 const qaId=psql("insert into public.social_threads(district_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at,provider_metadata,created_at,updated_at) values('district-b','meta','facebook','controlled-qa','https://x/qa','ambient','2026-08-05T13:02:00Z','{\"rollback_fixture_marker\":\"controlled-qa:test-1\"}','2026-08-05T13:02:00Z','2026-08-05T13:02:00Z') returning id;").stdout.trim();
 const evidenceRaw=psql(`set canary.social_backup_watermark='2026-08-05T12:00:00.000000Z';${captureEvidenceSql}`).stdout;
 const evidenceSource=parseJson(evidenceRaw);
 assert.equal(evidenceSource.correctionRequests.length,2);assert.ok(evidenceSource.correctionRequests[0].requestPayload);assert.ok(evidenceSource.correctionRequests[0].resultRow);
 await writeFile(join(temp,'evidence-input.csv'),csv('social_rollback_evidence',evidenceSource));
 const qa=evidenceSource.changedRows.find((row)=>row.id===qaId);
 await writeFile(join(temp,'qa-manifest.json'),JSON.stringify({fixtures:[{id:qa.id,tenant:qa.tenant,fixtureMarker:'controlled-qa:test-1',currentChecksumSha256:qa.currentChecksumSha256}]}));
 const forgedQa=node('scripts/capture-social-rollback-evidence.mjs',['--input',join(temp,'evidence-input.csv'),'--visibility-backup',join(temp,'backup.json'),'--qa-fixture-manifest',join(temp,'qa-manifest.json'),'--output',join(temp,'forged-qa-evidence.json')],false);
 assert.match(forgedQa.stderr,/does not accept QA deletion manifests/i);
 const staleSource=structuredClone(evidenceSource);staleSource.correctionRequests[0].resultRow.body='tampered-result';staleSource.correctionRequests[0].retainedRow.result_row.body='tampered-result';staleSource.correctionRequests[0].resultRowCanonical=JSON.stringify(staleSource.correctionRequests[0].resultRow);
 await writeFile(join(temp,'stale-evidence-input.csv'),csv('social_rollback_evidence',staleSource));
 const stale=node('scripts/capture-social-rollback-evidence.mjs',['--input',join(temp,'stale-evidence-input.csv'),'--visibility-backup',join(temp,'backup.json'),'--output',join(temp,'stale-evidence.json')],false);
 assert.match(stale.stderr,/retained checksum mismatch/i);
 node('scripts/capture-social-rollback-evidence.mjs',['--input',join(temp,'evidence-input.csv'),'--visibility-backup',join(temp,'backup.json'),'--output',join(temp,'rollback-evidence.json')]);
 const evidence=JSON.parse(await readFile(join(temp,'rollback-evidence.json'),'utf8'));
 assert.equal(evidence.manifest.correctionRequestCount,2);assert.equal(evidence.manifest.replayRowCount,5);assert.equal(evidence.manifest.createdRowCount,3);assert.equal(evidence.manifest.refreshedPreexistingRowCount,2);assert.equal(evidence.manifest.qaFixtureDeleteCount,undefined);
 assert.equal((await stat(join(temp,'rollback-evidence.json'))).mode&0o777,0o600);
 const injected=structuredClone(evidence);injected.manifest.audit.batchCount="0); drop table public.social_threads; --";reseal(injected);await writeFile(join(temp,'injected-evidence.json'),JSON.stringify(injected));
 const injection=node('scripts/prepare-social-rollback.mjs',['--evidence-artifact',join(temp,'injected-evidence.json'),'--sql-output',join(temp,'injected-down.sql')],false);
 assert.match(injection.stderr,/non-negative safe integer/i);
 const unbacked=psql(down,false);assert.match(unbacked.stderr,/prepare-social-rollback/i);assert.equal(psql('select count(*) from public.social_correction_requests;').stdout.trim(),'2');
 node('scripts/prepare-social-rollback.mjs',['--evidence-artifact',join(temp,'rollback-evidence.json'),'--sql-output',join(temp,'down.sql')]);
 const generatedDown=await readFile(join(temp,'down.sql'),'utf8');
 const auditTamperCases=[
  ['batch criteria',`alter table public.social_review_batches disable trigger social_review_batches_immutable;update public.social_review_batches set criteria=criteria||'{"tampered":true}'::jsonb where id=(select id from public.social_review_batches order by id limit 1);alter table public.social_review_batches enable trigger social_review_batches_immutable`],
  ['batch action',`alter table public.social_review_batches disable trigger social_review_batches_immutable;update public.social_review_batches set action='restore' where id=(select id from public.social_review_batches order by id limit 1);alter table public.social_review_batches enable trigger social_review_batches_immutable`],
  ['batch actor',`alter table public.social_review_batches disable trigger social_review_batches_immutable;update public.social_review_batches set actor_user_id='cccccccc-cccc-cccc-cccc-cccccccccccc' where id=(select id from public.social_review_batches order by id limit 1);alter table public.social_review_batches enable trigger social_review_batches_immutable`],
  ['batch count',`alter table public.social_review_batches disable trigger social_review_batches_immutable;update public.social_review_batches set item_count=item_count+1 where id=(select id from public.social_review_batches order by id limit 1);alter table public.social_review_batches enable trigger social_review_batches_immutable`],
  ['batch timestamp',`alter table public.social_review_batches disable trigger social_review_batches_immutable;update public.social_review_batches set created_at=created_at+interval '1 microsecond' where id=(select id from public.social_review_batches order by id limit 1);alter table public.social_review_batches enable trigger social_review_batches_immutable`],
  ['event before state',`alter table public.social_review_events disable trigger social_review_events_immutable;update public.social_review_events set before_state=before_state||'{"tampered":true}'::jsonb where id=(select id from public.social_review_events order by id limit 1);alter table public.social_review_events enable trigger social_review_events_immutable`],
  ['event after state',`alter table public.social_review_events disable trigger social_review_events_immutable;update public.social_review_events set after_state=after_state||'{"tampered":true}'::jsonb where id=(select id from public.social_review_events order by id limit 1);alter table public.social_review_events enable trigger social_review_events_immutable`],
  ['event action',`alter table public.social_review_events disable trigger social_review_events_immutable;update public.social_review_events set action='restore' where id=(select id from public.social_review_events order by id limit 1);alter table public.social_review_events enable trigger social_review_events_immutable`],
  ['event actor',`alter table public.social_review_events disable trigger social_review_events_immutable;update public.social_review_events set actor_user_id='cccccccc-cccc-cccc-cccc-cccccccccccc' where id=(select id from public.social_review_events order by id limit 1);alter table public.social_review_events enable trigger social_review_events_immutable`],
  ['event version',`alter table public.social_review_events disable trigger social_review_events_immutable;update public.social_review_events set resulting_version=resulting_version+1 where id=(select id from public.social_review_events order by id limit 1);alter table public.social_review_events enable trigger social_review_events_immutable`],
  ['event timestamp',`alter table public.social_review_events disable trigger social_review_events_immutable;update public.social_review_events set created_at=created_at+interval '1 microsecond' where id=(select id from public.social_review_events order by id limit 1);alter table public.social_review_events enable trigger social_review_events_immutable`],
 ];
 for(const [label,mutation] of auditTamperCases){
  const tampered=psql(`begin;${mutation};${generatedDown}`,false);
  assert.match(tampered.stderr,/complete immutable audit rows|audit proof is invalid/i,`${label} tampering must fail closed`);
 }
 const replacementDown=psql(`begin;alter table public.social_correction_requests rename to captured_task4_table;
   alter function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text) rename to captured_task4_apply;
   alter function public.canary_ingest_social_thread(jsonb) rename to captured_task4_ingest;
   create table public.social_correction_requests (like public.captured_task4_table including all);
   create function public.canary_apply_social_correction(uuid,text,uuid,text,integer,text) returns public.social_threads language sql as 'select null::public.social_threads';
   create function public.canary_ingest_social_thread(jsonb) returns public.social_threads language sql as 'select null::public.social_threads';
   ${generatedDown}`,false);
 assert.match(replacementDown.stderr,/replacements, not the exact captured OIDs/i);
 const missingAudit=psql(`begin; alter table public.social_review_events rename to social_review_events_missing; ${generatedDown}`,false);
 assert.match(missingAudit.stderr,/audit tables|social_review_events/i);assert.equal(psql("select to_regclass('public.social_review_events') is not null;").stdout.trim(),'t');
 const auditBefore=psql("select jsonb_build_object('b',(select count(*) from social_review_batches),'e',(select count(*) from social_review_events),'l',(select string_agg(id::text||':'||batch_id::text||':'||social_thread_id::text,',' order by id) from social_review_events));").stdout.trim();
 psql(generatedDown);
 assert.equal(psql("select to_regclass('public.social_correction_requests') is null;").stdout.trim(),'t');
 assert.equal(psql("select count(*) from social_review_events e join social_review_batches b on b.id=e.batch_id join social_threads t on t.id=e.social_thread_id;").stdout.trim(),'2');
 node('scripts/restore-social-visibility.mjs',['--artifact',join(temp,'backup.json'),'--sql-output',join(temp,'missing-evidence.sql')],false);
 node('scripts/restore-social-visibility.mjs',['--artifact',join(temp,'unsafe.json'),'--rollback-evidence',join(temp,'rollback-evidence.json'),'--sql-output',join(temp,'unsafe-restore.sql')],false);
 node('scripts/restore-social-visibility.mjs',['--artifact',join(temp,'backup.json'),'--rollback-evidence',join(temp,'rollback-evidence.json'),'--sql-output',join(temp,'restore.sql')]);
 const restoreSql=await readFile(join(temp,'restore.sql'),'utf8');
 for(const [label,mutation] of [auditTamperCases[0],auditTamperCases[5]]){
  const tamperedRestore=psql(`begin;${mutation};${restoreSql}`,false);
  assert.match(tamperedRestore.stderr,/Immutable Social audit rows|audit.*differ/i,`${label} tampering must also block restoration`);
 }
 const wrongRetainedIdentity=psql(`begin;alter table social_threads alter column visibility_status set default 'active';${restoreSql}`,false);assert.match(wrongRetainedIdentity.stderr,/N-1 migration-state identity/i);
 const changed=psql(`begin; update social_threads set body='tampered' where id='${activeId}'; ${restoreSql}`,false);assert.match(changed.stderr,/changed|evidence|checksum/i);
 psql(`insert into public.social_threads(district_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at,created_at,updated_at) values('district-b','meta','facebook','phantom-before-watermark','https://x/phantom','ambient','2026-08-05T11:00:00Z','2026-08-05T11:00:00Z','2026-08-05T11:00:00Z');`);
 psql(restoreSql,false);psql("delete from public.social_threads where external_thread_id='phantom-before-watermark';");psql(restoreSql);
 const restoredSeal=psql(`set canary.expected_social_state='N-1';${verify}`,false);
 assert.match(restoredSeal.stderr,/requires complete exact Task 4 additive objects/i);
 const restored=parseJson(psql(boundRestoredVerify).stdout);
 assert.equal(restored.verification_identity,'exact-restored-pure-n-1-non-sealing');
 assert.equal(restored.sealable,false);
 assert.equal(restored.pure_n1_schema_fingerprint_md5,pureN1.pure_n1_schema_fingerprint_md5);assert.deepEqual(functionMd5(),expectedFunctionMd5);
 assert.ok(restored.objects.some(({kind,name})=>kind==='relation_owner'&&name==='social_threads'));
 assert.ok(restored.objects.some(({kind,name})=>kind==='function_owner'&&name==='canary_assert_social_reviewer(uuid)'));
 const restoredTableOwnerDrift=psql(`begin;alter table public.social_threads owner to authenticated;${boundRestoredVerify}`,false);
 assert.match(restoredTableOwnerDrift.stderr,/Restored Social relation ownership differs from exact postgres baseline/i);
 const restoredFunctionOwnerDrift=psql(`begin;alter function public.canary_assert_social_reviewer(uuid) owner to authenticated;${boundRestoredVerify}`,false);
 assert.match(restoredFunctionOwnerDrift.stderr,/Restored Social function ownership differs from exact postgres baseline/i);
 await writeFile(join(temp,'restored.csv'),csv('social_restored_n1_verification',restored));
 node('scripts/verify-social-restored-n1.mjs',['--input',join(temp,'restored.csv'),'--baseline-artifact',join(temp,'pure-n1-baseline.json'),'--additive-contract',join(temp,'n1-contract.json'),'--output',join(temp,'restored-evidence.json')]);
 assert.equal(JSON.parse(await readFile(join(temp,'restored-evidence.json'),'utf8')).sealable,false);
 assert.equal(psql(`select visibility_status from social_threads where id='${activeId}';`).stdout.trim(),'review');
 assert.equal(psql(`select visibility_status from social_threads where id='${excludedId}';`).stdout.trim(),'excluded');
 assert.equal(psql(`select visibility_status from social_threads where id='${qaId}';`).stdout.trim(),'review');
 assert.equal(psql("select jsonb_build_object('b',(select count(*) from social_review_batches),'e',(select count(*) from social_review_events),'l',(select string_agg(id::text||':'||batch_id::text||':'||social_thread_id::text,',' order by id) from social_review_events));").stdout.trim(),auditBefore);
 const restoredRows=parseJson(psql(`select jsonb_agg(jsonb_build_object('id',id::text,'district_id',district_id,'relationship_type',relationship_type,'visibility_status',visibility_status,'review_version',review_version,'reviewed_at',case when reviewed_at is null then null else to_char(reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'reviewed_by',reviewed_by::text,'created_at',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by id) from public.social_threads where created_at<='2026-08-05T12:00:00Z';`).stdout);
 const expectedRestoredRows=backup.rows.map(({canonical_checksum_sha256,...row})=>row.id==='50000000-0000-0000-0000-000000000002'?{...row,updated_at:evidence.changedRows.find((entry)=>entry.id===row.id).row.updated_at.replace('+00:00','Z')}:row);
 assert.deepEqual(restoredRows,expectedRestoredRows);
 const refreshedRestored=parseJson(psql(`select jsonb_build_object('headline',headline,'body',body,'comment_count',comment_count,'provider_metadata',provider_metadata,'visibility_status',visibility_status,'review_version',review_version,'reviewed_at',to_char(reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'reviewed_by',reviewed_by::text) from public.social_threads where id='50000000-0000-0000-0000-000000000002';`).stdout);
 assert.deepEqual(refreshedRestored,{headline:'refreshed backed headline',body:'refreshed backed body',comment_count:42,provider_metadata:{refresh:'task5-routine'},visibility_status:'approved',review_version:1,reviewed_at:'2026-08-02T00:00:00.000000Z',reviewed_by:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
 assert.equal(psql(`begin;select (public.canary_review_social_thread('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','50000000-0000-0000-0000-000000000001','approve',0)).visibility_status;rollback;`).stdout.trim(),'approved');
 console.log('Social visibility migration PostgreSQL test passed: exact N-1/N Task 4 duplicate rejection, injection-safe evidence, source-bound pre-watermark correction restoration, retained checksum recomputation, audit preservation, exact restore, and fail-closed post-watermark replay.');
}finally{if(started)spawnSync('docker',['rm','--force',container],{encoding:'utf8'});assert.equal(spawnSync('docker',['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}'],{encoding:'utf8'}).stdout.trim(),'');}
