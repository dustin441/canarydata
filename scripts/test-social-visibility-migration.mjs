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
 run('docker',['run','--detach','--rm','--name',container,'-e','POSTGRES_PASSWORD=test-only',image]);started=true;
 for(let i=0;i<60;i+=1){const ready=spawnSync('docker',['exec',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-c','select 1'],{encoding:'utf8'});if(ready.status===0)break;await new Promise((resolve)=>setTimeout(resolve,250));if(i===59)throw new Error(`PostgreSQL not ready: ${ready.stderr}`);}
 const [fixture,capturedN1,task4,forward,down,verify,captureEvidenceSql]=await Promise.all([
  file('scripts/fixtures/social-n1.sql'),file('scripts/fixtures/social-n1-production-captured.sql'),file('supabase/migrations/20260804193000_social_visibility_lifecycle.sql'),file('supabase/migrations/20260805120000_social_visibility_active.sql'),file('supabase/rollbacks/20260805120000_social_visibility_active_down.sql'),file('supabase/verify_social_visibility_contract.sql'),file('supabase/capture_social_rollback_evidence_readonly.sql')]);
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
 const n1Raw=psql(`set canary.expected_social_state='N-1';set canary.expected_social_rows='6';set canary.expected_social_exclusions='1';${verify}`).stdout;
 const n1=parseJson(n1Raw);
 assert.equal(n1.migration_state_identity,'task5-n-1');
 await writeFile(join(temp,'n1-raw.txt'),n1Raw);
 await writeFile(join(temp,'n1.csv'),csv('social_visibility_contract',n1));
 node('scripts/capture-social-schema-contract.mjs',['--input',join(temp,'n1.csv'),'--output',join(temp,'n1-contract.json')]);
 const contract=JSON.parse(await readFile(join(temp,'n1-contract.json'),'utf8'));
 assert.equal(contract.toolVersion,'2.0.0');assert.equal(contract.migrationStateIdentity,'task5-n-1');
 const rows=parseJson(psql(`select jsonb_build_object('watermark','2026-08-05T12:00:00.000000Z','rows',jsonb_agg(jsonb_build_object('id',id::text,'district_id',district_id,'relationship_type',relationship_type,'visibility_status',visibility_status,'review_version',review_version,'reviewed_at',case when reviewed_at is null then null else to_char(reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'reviewed_by',reviewed_by::text,'created_at',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by id)) from public.social_threads;`).stdout);
 await writeFile(join(temp,'rows.csv'),csv('social_visibility_backup',rows));
 node('scripts/backup-social-visibility.mjs',['--input',join(temp,'rows.csv'),'--schema-contract',join(temp,'n1-contract.json'),'--output',join(temp,'backup.json')]);
 const backup=JSON.parse(await readFile(join(temp,'backup.json'),'utf8'));
 assert.equal(backup.manifest.verificationMode,'production-sealed-schema-contract');assert.equal(backup.manifest.schemaContractArtifactSha256,contract.artifactSha256);
 assert.equal((await stat(join(temp,'backup.json'))).mode&0o777,0o600);
 const unsafe=node('scripts/backup-social-visibility.mjs',['--input',join(temp,'rows.csv'),'--schema-identity',n1.schema_identity,'--schema-fingerprint',n1.schema_fingerprint_md5,'--expected-row-count','6','--output',join(temp,'unsafe.json')],false);
 assert.match(unsafe.stderr,/unsafe-dev-schema-assertions/i);
 node('scripts/backup-social-visibility.mjs',['--input',join(temp,'rows.csv'),'--schema-identity',n1.schema_identity,'--schema-fingerprint',n1.schema_fingerprint_md5,'--expected-row-count','6','--unsafe-dev-schema-assertions','--output',join(temp,'unsafe.json')]);
 assert.equal(JSON.parse(await readFile(join(temp,'unsafe.json'),'utf8')).manifest.verificationMode,'unsafe-development-only');
 psql(forward,false);psql(task4);const officialBefore=n1.official_report_set_md5;psql(forward);psql(forward);
 const n=parseJson(psql(`set canary.expected_social_state='N';set canary.expected_social_rows='6';set canary.expected_social_exclusions='1';${verify}`).stdout);
 assert.deepEqual(n.status_counts,{active:5,excluded:1});assert.equal(n.official_report_set_md5,officialBefore);assert.equal(n.migration_state_identity,'task5-n');
 await writeFile(join(temp,'n-contract-input.csv'),csv('social_visibility_contract',n));
 node('scripts/capture-social-schema-contract.mjs',['--input',join(temp,'n-contract-input.csv'),'--output',join(temp,'n-contract.json')]);
 const wrongIdentity=node('scripts/backup-social-visibility.mjs',['--input',join(temp,'rows.csv'),'--schema-contract',join(temp,'n-contract.json'),'--output',join(temp,'n-backup.json')],false);
 assert.match(wrongIdentity.stderr,/task5-n-1/i);
 psql("select (public.canary_apply_social_correction('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','district-a','50000000-0000-0000-0000-000000000001','exclude',0,'pre-watermark-correction-01')).id;");
 const activeId=psql("insert into public.social_threads(district_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at,created_at,updated_at) values('district-b','meta','facebook','real-active','https://x/new','ambient','2026-08-05T13:00:00Z','2026-08-05T13:00:00Z','2026-08-05T13:00:00Z') returning id;").stdout.trim();
 const excludedId=psql("insert into public.social_threads(district_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at,created_at,updated_at) values('district-b','meta','facebook','real-excluded','https://x/excluded','ambient','2026-08-05T13:01:00Z','2026-08-05T13:01:00Z','2026-08-05T13:01:00Z') returning id;").stdout.trim();
 psql(`select (public.canary_apply_social_correction('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','district-b','${excludedId}','exclude',0,'rollback-proof-01')).id;`);
 const qaId=psql("insert into public.social_threads(district_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at,provider_metadata,created_at,updated_at) values('district-b','meta','facebook','controlled-qa','https://x/qa','ambient','2026-08-05T13:02:00Z','{\"rollback_fixture_marker\":\"controlled-qa:test-1\"}','2026-08-05T13:02:00Z','2026-08-05T13:02:00Z') returning id;").stdout.trim();
 const evidenceRaw=psql(`set canary.social_backup_watermark='2026-08-05T12:00:00.000000Z';${captureEvidenceSql}`).stdout;
 const evidenceSource=parseJson(evidenceRaw);
 assert.equal(evidenceSource.correctionRequests.length,2);assert.ok(evidenceSource.correctionRequests[0].requestPayload);assert.ok(evidenceSource.correctionRequests[0].resultRow);
 await writeFile(join(temp,'evidence-input.csv'),csv('social_rollback_evidence',evidenceSource));
 const qa=evidenceSource.postWatermarkRows.find((row)=>row.id===qaId);
 await writeFile(join(temp,'qa-manifest.json'),JSON.stringify({fixtures:[{id:qa.id,tenant:qa.tenant,fixtureMarker:'controlled-qa:test-1',currentChecksumSha256:qa.currentChecksumSha256}]}));
 const forgedQa=node('scripts/capture-social-rollback-evidence.mjs',['--input',join(temp,'evidence-input.csv'),'--visibility-backup',join(temp,'backup.json'),'--qa-fixture-manifest',join(temp,'qa-manifest.json'),'--output',join(temp,'forged-qa-evidence.json')],false);
 assert.match(forgedQa.stderr,/does not accept QA deletion manifests/i);
 const staleSource=structuredClone(evidenceSource);staleSource.correctionRequests[0].resultRow.body='tampered-result';staleSource.correctionRequests[0].retainedRow.result_row.body='tampered-result';staleSource.correctionRequests[0].resultRowCanonical=JSON.stringify(staleSource.correctionRequests[0].resultRow);
 await writeFile(join(temp,'stale-evidence-input.csv'),csv('social_rollback_evidence',staleSource));
 const stale=node('scripts/capture-social-rollback-evidence.mjs',['--input',join(temp,'stale-evidence-input.csv'),'--visibility-backup',join(temp,'backup.json'),'--output',join(temp,'stale-evidence.json')],false);
 assert.match(stale.stderr,/retained checksum mismatch/i);
 node('scripts/capture-social-rollback-evidence.mjs',['--input',join(temp,'evidence-input.csv'),'--visibility-backup',join(temp,'backup.json'),'--output',join(temp,'rollback-evidence.json')]);
 const evidence=JSON.parse(await readFile(join(temp,'rollback-evidence.json'),'utf8'));
 assert.equal(evidence.manifest.correctionRequestCount,2);assert.equal(evidence.manifest.replayRowCount,3);assert.equal(evidence.manifest.qaFixtureDeleteCount,undefined);
 assert.equal((await stat(join(temp,'rollback-evidence.json'))).mode&0o777,0o600);
 const injected=structuredClone(evidence);injected.manifest.audit.batchCount="0); drop table public.social_threads; --";reseal(injected);await writeFile(join(temp,'injected-evidence.json'),JSON.stringify(injected));
 const injection=node('scripts/prepare-social-rollback.mjs',['--evidence-artifact',join(temp,'injected-evidence.json'),'--sql-output',join(temp,'injected-down.sql')],false);
 assert.match(injection.stderr,/non-negative safe integer/i);
 const unbacked=psql(down,false);assert.match(unbacked.stderr,/prepare-social-rollback/i);assert.equal(psql('select count(*) from public.social_correction_requests;').stdout.trim(),'2');
 node('scripts/prepare-social-rollback.mjs',['--evidence-artifact',join(temp,'rollback-evidence.json'),'--sql-output',join(temp,'down.sql')]);
 const generatedDown=await readFile(join(temp,'down.sql'),'utf8');
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
 const wrongRetainedIdentity=psql(`begin;alter table social_threads alter column visibility_status set default 'active';${restoreSql}`,false);assert.match(wrongRetainedIdentity.stderr,/N-1 migration-state identity/i);
 const changed=psql(`begin; update social_threads set body='tampered' where id='${activeId}'; ${restoreSql}`,false);assert.match(changed.stderr,/changed|evidence|checksum/i);
 psql(`insert into public.social_threads(district_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at,created_at,updated_at) values('district-b','meta','facebook','phantom-before-watermark','https://x/phantom','ambient','2026-08-05T11:00:00Z','2026-08-05T11:00:00Z','2026-08-05T11:00:00Z');`);
 psql(restoreSql,false);psql("delete from public.social_threads where external_thread_id='phantom-before-watermark';");psql(restoreSql);
 const restored=parseJson(psql(`set canary.expected_social_state='N-1';set canary.expected_social_rows='9';set canary.expected_social_exclusions='2';${verify}`).stdout);
 assert.equal(restored.schema_fingerprint_md5,n1.schema_fingerprint_md5);assert.deepEqual(functionMd5(),expectedFunctionMd5);
 assert.equal(psql(`select visibility_status from social_threads where id='${activeId}';`).stdout.trim(),'review');
 assert.equal(psql(`select visibility_status from social_threads where id='${excludedId}';`).stdout.trim(),'excluded');
 assert.equal(psql(`select visibility_status from social_threads where id='${qaId}';`).stdout.trim(),'review');
 assert.equal(psql("select jsonb_build_object('b',(select count(*) from social_review_batches),'e',(select count(*) from social_review_events),'l',(select string_agg(id::text||':'||batch_id::text||':'||social_thread_id::text,',' order by id) from social_review_events));").stdout.trim(),auditBefore);
 const restoredRows=parseJson(psql(`select jsonb_agg(jsonb_build_object('id',id::text,'district_id',district_id,'relationship_type',relationship_type,'visibility_status',visibility_status,'review_version',review_version,'reviewed_at',case when reviewed_at is null then null else to_char(reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'reviewed_by',reviewed_by::text,'created_at',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by id) from public.social_threads where created_at<='2026-08-05T12:00:00Z';`).stdout);
 assert.deepEqual(restoredRows,backup.rows.map(({canonical_checksum_sha256,...row})=>row));
 assert.equal(psql(`begin;select (public.canary_review_social_thread('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','50000000-0000-0000-0000-000000000001','approve',0)).visibility_status;rollback;`).stdout.trim(),'approved');
 console.log('Social visibility migration PostgreSQL test passed: exact N-1 contracts, injection-safe evidence, source-bound pre-watermark correction restoration, retained checksum recomputation, audit preservation, exact restore, and fail-closed post-watermark replay.');
}finally{if(started)spawnSync('docker',['rm','--force',container],{encoding:'utf8'});assert.equal(spawnSync('docker',['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}'],{encoding:'utf8'}).stdout.trim(),'');}
