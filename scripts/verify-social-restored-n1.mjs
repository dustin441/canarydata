#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseSqlEditorExport, unwrapSingleSqlEditorValue } from './lib/sql-editor-input.mjs';

const argv=process.argv.slice(2);
const get=(name)=>{const i=argv.indexOf(`--${name}`);return i<0?undefined:argv[i+1];};
const canonicalJson=(value)=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonicalJson).join(',')}]`:`{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
const sha256=(value)=>createHash('sha256').update(value).digest('hex');
const sql=await readFile(new URL('../supabase/verify_social_restored_n1.sql',import.meta.url),'utf8');
const parseOutput=(text)=>unwrapSingleSqlEditorValue(parseSqlEditorExport(text,'social_restored_n1_verification'),'social_restored_n1_verification');
const readArtifact=async(path,format)=>{const artifact=JSON.parse(await readFile(path,'utf8'));assert.equal(artifact.format,format);const claimed=artifact.artifactSha256;assert.match(claimed||'',/^[a-f0-9]{64}$/);assert.equal(sha256(canonicalJson({...artifact,artifactSha256:null})),claimed,`${format} artifact SHA-256 mismatch`);return artifact;};
const validateOids=(oids)=>{assert.deepEqual(Object.keys(oids||{}).sort(),['canary_apply_social_correction','canary_ingest_social_thread','social_correction_requests']);for(const value of Object.values(oids))assert.ok(Number.isSafeInteger(value)&&value>0,'Task 4 OIDs must be positive safe integers');return oids;};

if(get('capture-baseline-input')){
  const result=parseOutput(await readFile(get('capture-baseline-input'),'utf8'));
  assert.equal(result.verification_identity,'exact-restored-pure-n-1-non-sealing');
  assert.equal(result.sealable,false);
  assert.equal(result.expected_task4_object_oids,null,'Baseline capture cannot be OID-bound restored evidence');
  assert.match(result.pure_n1_schema_fingerprint_md5||'',/^[a-f0-9]{32}$/);
  const artifact={format:'canary-social-pure-n1-baseline/v1',capturedBy:'scripts/verify-social-restored-n1.mjs',sealable:false,pureN1SchemaFingerprintMd5:result.pure_n1_schema_fingerprint_md5,objects:result.objects,artifactSha256:null};
  artifact.artifactSha256=sha256(canonicalJson(artifact));
  assert.ok(get('output'),'--output is required');
  await writeFile(get('output'),`${JSON.stringify(artifact,null,2)}\n`,{mode:0o600,flag:'wx'});
  console.log(`Wrote non-sealing pure N-1 baseline: ${artifact.artifactSha256}; output=${get('output')}`);
  process.exit(0);
}

const baselinePath=get('baseline-artifact');
const additivePath=get('additive-contract');
assert.ok(baselinePath&&additivePath,'--baseline-artifact and --additive-contract are required');
const baseline=await readArtifact(baselinePath,'canary-social-pure-n1-baseline/v1');
assert.equal(baseline.sealable,false);
assert.match(baseline.pureN1SchemaFingerprintMd5||'',/^[a-f0-9]{32}$/);
const additive=await readArtifact(additivePath,'canary-social-schema-contract/v1');
assert.equal(additive.migrationStateIdentity,'task5-n-1','Restored verification requires the pre-forward sealed additive task5-n-1 contract');
assert.equal(additive.contract?.migration_state_identity,'task5-n-1');
const oids=validateOids(additive.contract?.task4_object_oids);
const settings=`set canary.expected_task4_table_oid='${oids.social_correction_requests}';\nset canary.expected_task4_apply_oid='${oids.canary_apply_social_correction}';\nset canary.expected_task4_ingest_oid='${oids.canary_ingest_social_thread}';\nset canary.expected_pure_n1_fingerprint='${baseline.pureN1SchemaFingerprintMd5}';\n`;
if(get('sql-output')){
  await writeFile(get('sql-output'),settings+sql,{mode:0o600,flag:'wx'});
  console.log(`Wrote OID-bound non-sealing restored N-1 verifier: ${get('sql-output')}`);
  process.exit(0);
}
assert.ok(get('input')&&get('output'),'Provide --input and --output, or --sql-output');
const result=parseOutput(await readFile(get('input'),'utf8'));
assert.equal(result.verification_identity,'exact-restored-pure-n-1-non-sealing');
assert.equal(result.sealable,false);
assert.equal(result.pure_n1_schema_fingerprint_md5,baseline.pureN1SchemaFingerprintMd5,'Pure N-1 object fingerprint differs from captured baseline');
assert.deepEqual(result.expected_task4_object_oids,oids,'Restored verification is bound to different Task 4 OIDs');
const artifact={format:'canary-social-restored-n1-verification/v1',verifiedBy:'scripts/verify-social-restored-n1.mjs',sealable:false,baselineArtifactSha256:baseline.artifactSha256,additiveContractArtifactSha256:additive.artifactSha256,verification:result,artifactSha256:null};
artifact.artifactSha256=sha256(canonicalJson(artifact));
await writeFile(get('output'),`${JSON.stringify(artifact,null,2)}\n`,{mode:0o600,flag:'wx'});
console.log(`Wrote non-sealing exact restored N-1 evidence: ${artifact.artifactSha256}; output=${get('output')}`);
