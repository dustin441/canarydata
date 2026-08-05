#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root=new URL('..',import.meta.url).pathname;
const image='postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const container=`canary-social-migration-${process.pid}-${randomBytes(3).toString('hex')}`;
const temp=await mkdtemp(join(tmpdir(),'canary-social-migration-'));
const run=(command,args,options={})=>{const result=spawnSync(command,args,{encoding:'utf8',...options});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed (${result.status}): ${result.stderr||result.stdout}`);return result.stdout;};
const psql=(sql,ok=true)=>{const result=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:sql,encoding:'utf8',maxBuffer:64*1024*1024});if(ok&&result.status!==0)throw new Error(result.stderr);if(!ok&&result.status===0)throw new Error('Expected SQL failure');return result;};
const file=async(path)=>readFile(join(root,path),'utf8');
const node=(script,args,ok=true)=>{const result=spawnSync(process.execPath,[join(root,script),...args],{encoding:'utf8',maxBuffer:64*1024*1024});if(ok&&result.status!==0)throw new Error(result.stderr||result.stdout);if(!ok&&result.status===0)throw new Error(`Expected ${script} failure`);return result;};
const parseJson=(text)=>JSON.parse(text.trim());
const sha256=(value)=>createHash('sha256').update(value).digest('hex');
const fields=['id','district_id','relationship_type','visibility_status','review_version','reviewed_at','reviewed_by','created_at','updated_at'];
const checksum=(row)=>sha256(fields.map((field)=>{const value=row[field]===null||row[field]===undefined?'<NULL>':String(row[field]);return `${Buffer.byteLength(value)}:${value}`;}).join('|'));
let started=false;
try{
 run('docker',['run','--detach','--rm','--name',container,'-e','POSTGRES_PASSWORD=test-only',image]);started=true;
 for(let i=0;i<60;i+=1){
  const ready=spawnSync('docker',['exec',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-c','select 1'],{encoding:'utf8'});
  if(ready.status===0)break;
  await new Promise((resolve)=>setTimeout(resolve,250));
  if(i===59)throw new Error(`PostgreSQL not ready: ${ready.stderr}`);
 }
 const [fixture,capturedN1,task4,forward,down,verify]=await Promise.all([
  file('scripts/fixtures/social-n1.sql'),file('scripts/fixtures/social-n1-production-captured.sql'),file('supabase/migrations/20260804193000_social_visibility_lifecycle.sql'),file('supabase/migrations/20260805120000_social_visibility_active.sql'),file('supabase/rollbacks/20260805120000_social_visibility_active_down.sql'),file('supabase/verify_social_visibility_contract.sql')]);
 psql(fixture);psql(capturedN1);
 const expectedFunctionMd5={
  canary_assert_social_reviewer:'f8acecd019a7182f9394ca2ce1d78a67',
  canary_bulk_review_social_threads:'8bd52d87cc68594f993f0e8f4b7c29bb',
  canary_review_social_thread:'c4f851bf607f11545d47ef2b04b29740',
  prevent_social_review_audit_mutation:'7f325916f94da40cbf15014e320345d6',
  touch_social_updated_at:'feff1b4a6c026311cd0a6164d5f96a65',
 };
 const functionMd5=()=>parseJson(psql(`select jsonb_object_agg(proname,definition_md5 order by proname) from (select p.proname,md5(pg_get_functiondef(p.oid)) definition_md5 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['canary_assert_social_reviewer','canary_bulk_review_social_threads','canary_review_social_thread','prevent_social_review_audit_mutation','touch_social_updated_at'])) x;`).stdout);
 assert.deepEqual(functionMd5(),expectedFunctionMd5,'Disposable N-1 fixture must be the captured production function contract');
 const seed=`insert into public.social_threads(id,district_id,social_account_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at,visibility_status,review_version,reviewed_at,reviewed_by,created_at,updated_at) values
 ('50000000-0000-0000-0000-000000000001','district-a','11111111-1111-1111-1111-111111111111','meta','facebook','a-review-owned','https://x/1','owned','2026-08-01Z','review',0,null,null,'2026-08-01Z','2026-08-01Z'),
 ('50000000-0000-0000-0000-000000000002','district-a',null,'meta','facebook','a-approved-tag','https://x/2','direct_tag','2026-08-01Z','approved',1,'2026-08-02Z','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','2026-08-01Z','2026-08-02Z'),
 ('50000000-0000-0000-0000-000000000003','district-a',null,'meta','facebook','a-active-mention','https://x/3','direct_mention','2026-08-01Z','active',2,null,null,'2026-08-01Z','2026-08-01Z'),
 ('50000000-0000-0000-0000-000000000004','district-a',null,'meta','facebook','a-excluded-ambient','https://x/4','ambient','2026-08-01Z','excluded',3,null,null,'2026-08-01Z','2026-08-01Z'),
 ('50000000-0000-0000-0000-000000000005','district-b','22222222-2222-2222-2222-222222222222','meta','facebook','b-review-owned','https://x/5','owned','2026-08-01Z','review',4,null,null,'2026-08-01Z','2026-08-01Z'),
 ('50000000-0000-0000-0000-000000000006','district-b',null,'meta','facebook','b-review-ambient','https://x/6','ambient','2026-08-01Z','review',0,null,null,'2026-08-01Z','2026-08-01Z');`;
 psql(seed);
 const n1Raw=psql(`set canary.expected_social_state='N-1';set canary.expected_social_rows='6';set canary.expected_social_exclusions='1';${verify}`).stdout;
 const n1=parseJson(n1Raw);
 await writeFile(join(temp,'n1-raw.txt'),n1Raw);
 node('scripts/capture-social-schema-contract.mjs',['--input',join(temp,'n1-raw.txt'),'--output',join(temp,'n1-contract.json')]);
 const rows=parseJson(psql(`select jsonb_build_object('watermark','2026-08-05T12:00:00.000000Z','rows',jsonb_agg(jsonb_build_object('id',id::text,'district_id',district_id,'relationship_type',relationship_type,'visibility_status',visibility_status,'review_version',review_version,'reviewed_at',case when reviewed_at is null then null else to_char(reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'reviewed_by',reviewed_by::text,'created_at',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by id)) from public.social_threads;`).stdout);
 await writeFile(join(temp,'rows.json'),JSON.stringify([{social_visibility_backup:rows}]));
 await writeFile(join(temp,'partial-rows.json'),JSON.stringify([{social_visibility_backup:{...rows,rows:rows.rows.slice(0,-1)}}]));
 const corruptContract=JSON.parse(await readFile(join(temp,'n1-contract.json'),'utf8'));corruptContract.contract.schema_fingerprint_md5='00000000000000000000000000000000';await writeFile(join(temp,'corrupt-contract.json'),JSON.stringify(corruptContract));
 node('scripts/backup-social-visibility.mjs',['--input',join(temp,'rows.json'),'--schema-contract',join(temp,'corrupt-contract.json'),'--output',join(temp,'bad-contract-backup.json')],false);
 const partialContractResult=node('scripts/backup-social-visibility.mjs',['--input',join(temp,'partial-rows.json'),'--schema-contract',join(temp,'n1-contract.json'),'--output',join(temp,'partial-contract-backup.json')],false);
 assert.match(partialContractResult.stderr,/schema contract row count/i,'Schema contract must reject an omitted-row partial backup');
 const partialExpectedResult=node('scripts/backup-social-visibility.mjs',['--input',join(temp,'partial-rows.json'),'--schema-identity',n1.schema_identity,'--schema-fingerprint',n1.schema_fingerprint_md5,'--expected-row-count','6','--output',join(temp,'partial-expected-backup.json')],false);
 assert.match(partialExpectedResult.stderr,/expected row count/i,'Explicit expected count must reject an omitted-row partial backup');
 node('scripts/backup-social-visibility.mjs',['--input',join(temp,'rows.json'),'--schema-identity',n1.schema_identity,'--schema-fingerprint',n1.schema_fingerprint_md5,'--expected-row-count','6','--output',join(temp,'manual-backup.json')]);
 const manualBackup=JSON.parse(await readFile(join(temp,'manual-backup.json'),'utf8'));
 assert.equal(manualBackup.manifest.expectedRowCount,6,'Backup manifest must retain the enforced expected row count');
 manualBackup.manifest.expectedRowCount=5;await writeFile(join(temp,'tampered-expected-count-backup.json'),JSON.stringify(manualBackup));
 const tamperedExpectedResult=node('scripts/restore-social-visibility.mjs',['--artifact',join(temp,'tampered-expected-count-backup.json'),'--sql-output',join(temp,'tampered-expected-count.sql')],false);
 assert.match(tamperedExpectedResult.stderr,/artifact SHA-256 mismatch/i,'Artifact hash must cover expectedRowCount');
 node('scripts/backup-social-visibility.mjs',['--input',join(temp,'rows.json'),'--schema-contract',join(temp,'n1-contract.json'),'--output',join(temp,'backup.json')]);
 psql(forward,false); // Task 4 is mandatory and the failed transaction must leave N-1 intact.
 assert.match(psql("select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where a.attrelid='public.social_threads'::regclass and a.attname='visibility_status';").stdout,/review/);
 psql(task4);const officialBefore=n1.official_report_set_md5;psql(forward);psql(forward);
 const n=parseJson(psql(`set canary.expected_social_state='N';set canary.expected_social_rows='6';set canary.expected_social_exclusions='1';${verify}`).stdout);
 assert.deepEqual(n.status_counts,{active:5,excluded:1});assert.equal(n.official_report_set_md5,officialBefore,'Official set must not depend on visibility status');
 assert.equal(psql("insert into public.social_threads(district_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at,created_at,updated_at) values('district-b','meta','facebook','default-active','https://x/new','ambient','2026-08-05T13:00:00Z','2026-08-05T13:00:00Z','2026-08-05T13:00:00Z') returning visibility_status;").stdout.trim(),'active');
 psql(down);
 node('scripts/restore-social-visibility.mjs',['--artifact',join(temp,'missing.json'),'--sql-output',join(temp,'missing.sql')],false);
 const corrupt=JSON.parse(await readFile(join(temp,'backup.json'),'utf8'));corrupt.rows[0].visibility_status='excluded';await writeFile(join(temp,'corrupt.json'),JSON.stringify(corrupt));
 node('scripts/restore-social-visibility.mjs',['--artifact',join(temp,'corrupt.json'),'--sql-output',join(temp,'corrupt.sql')],false);
 node('scripts/restore-social-visibility.mjs',['--artifact',join(temp,'backup.json'),'--sql-output',join(temp,'restore-unresolved.sql')]);
 psql(await readFile(join(temp,'restore-unresolved.sql'),'utf8'),false);
 const post=parseJson(psql(`select jsonb_build_object('id',id::text,'district_id',district_id,'relationship_type',relationship_type,'visibility_status',visibility_status,'review_version',review_version,'reviewed_at',null,'reviewed_by',null,'created_at',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) from public.social_threads where external_thread_id='default-active';`).stdout);
 await writeFile(join(temp,'reconciled.json'),JSON.stringify({postWatermarkRows:[{id:post.id,currentChecksumSha256:checksum(post),disposition:'retain'}]}));
 node('scripts/restore-social-visibility.mjs',['--artifact',join(temp,'backup.json'),'--reconciled-change-set',join(temp,'reconciled.json'),'--sql-output',join(temp,'restore.sql')]);
 psql(`insert into public.social_threads(district_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at,created_at,updated_at) values('district-b','meta','facebook','phantom-before-watermark','https://x/phantom','ambient','2026-08-05T11:00:00Z','2026-08-05T11:00:00Z','2026-08-05T11:00:00Z');`);
 psql(await readFile(join(temp,'restore.sql'),'utf8'),false);
 psql(`delete from public.social_threads where external_thread_id='phantom-before-watermark';`);
 psql(await readFile(join(temp,'restore.sql'),'utf8'));
 const restored=parseJson(psql(`set canary.expected_social_state='N-1';set canary.expected_social_rows='7';set canary.expected_social_exclusions='1';${verify}`).stdout);
 assert.equal(restored.schema_fingerprint_md5,n1.schema_fingerprint_md5,'N-1 object fingerprint must restore exactly');
 assert.deepEqual(functionMd5(),expectedFunctionMd5,'Rollback must restore exact captured production function definitions');
 const restoredRows=parseJson(psql(`select jsonb_agg(jsonb_build_object('id',id::text,'district_id',district_id,'relationship_type',relationship_type,'visibility_status',visibility_status,'review_version',review_version,'reviewed_at',case when reviewed_at is null then null else to_char(reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'reviewed_by',reviewed_by::text,'created_at',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by id) from public.social_threads where external_thread_id<>'default-active';`).stdout);
 const backup=JSON.parse(await readFile(join(temp,'backup.json'),'utf8'));
 assert.deepEqual(restoredRows,backup.rows.map(({canonical_checksum_sha256,...row})=>row),'Every pre-watermark field must restore exactly');
 assert.equal(psql(`begin;select (public.canary_review_social_thread('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','50000000-0000-0000-0000-000000000001','approve',0)).visibility_status;rollback;`).stdout.trim(),'approved','Captured approve semantics must map review to approved');
 assert.equal(psql(`begin;select (public.canary_review_social_thread('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','50000000-0000-0000-0000-000000000002','promote',1)).visibility_status;rollback;`).stdout.trim(),'active','Captured promote semantics must map approved to active');
 assert.equal(psql(`begin;select (public.canary_review_social_thread('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','50000000-0000-0000-0000-000000000004','restore',3)).visibility_status;rollback;`).stdout.trim(),'review','Captured restore semantics must map excluded to review');
 assert.equal(psql(`begin;do $$begin perform public.canary_bulk_review_social_threads('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','district-b',array['50000000-0000-0000-0000-000000000005'::uuid],'approve_official');end$$;select visibility_status from public.social_threads where id='50000000-0000-0000-0000-000000000005';rollback;`).stdout.trim(),'approved','Captured bulk approve semantics must map eligible review rows to approved');
 console.log('Social visibility migration disposable PostgreSQL test passed: captured-production N-1 hashes/semantics, fail-closed preflight, complete-backup row-count enforcement, deterministic N mapping, default/exclusions/report set, corrupt backup rejection, post-watermark reconciliation, and exact N-1 schema/data restoration.');
}finally{if(started)spawnSync('docker',['rm','--force',container],{encoding:'utf8'});assert.equal(spawnSync('docker',['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}'],{encoding:'utf8'}).stdout.trim(),'');}
