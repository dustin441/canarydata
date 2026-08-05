#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const get = (name) => { const index = argv.indexOf(`--${name}`); return index < 0 ? undefined : argv[index + 1]; };
const canonicalJson = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const retainedCorrectionText = (request) => [request.actorUserId, request.idempotencyKey, request.requestPayloadCanonical, request.resultRowCanonical, request.createdAt, request.completedAt]
  .map((raw) => { const value = raw === null ? '<NULL>' : raw; return `${Buffer.byteLength(value, 'utf8')}:${value}`; }).join('|');
const assertCount = (value, label) => assert.ok(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative safe integer`);
const assertHash = (value, label) => assert.match(value || '', /^[a-f0-9]{64}$/, `${label} must be a SHA-256 hex digest`);
const artifactPath = get('evidence-artifact');
const output = get('sql-output');
assert.ok(artifactPath && output, '--evidence-artifact and --sql-output are required');
const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
assert.equal(artifact.format, 'canary-social-rollback-evidence/v1');
const claimedHash = artifact.manifest?.artifactSha256;
assertHash(claimedHash, 'Artifact hash');
artifact.manifest.artifactSha256 = null;
assert.equal(sha256(canonicalJson(artifact)), claimedHash, 'Rollback evidence artifact SHA-256 mismatch');
artifact.manifest.artifactSha256 = claimedHash;
assert.ok(Array.isArray(artifact.correctionRequests));
assert.ok(Array.isArray(artifact.postWatermarkRows));
for (const [value, label] of [
  [artifact.manifest.correctionRequestCount, 'Correction request count'],
  [artifact.manifest.postWatermarkRowCount, 'Post-watermark row count'],
  [artifact.manifest.replayRowCount, 'Replay row count'],
  [artifact.manifest.audit?.batchCount, 'Audit batch count'],
  [artifact.manifest.audit?.eventCount, 'Audit event count'],
]) assertCount(value, label);
const task4ObjectOids=artifact.manifest.task4ObjectOids;
assert.deepEqual(Object.keys(task4ObjectOids||{}).sort(),['canary_apply_social_correction','canary_ingest_social_thread','social_correction_requests']);
for(const [name,value] of Object.entries(task4ObjectOids)) assert.ok(Number.isSafeInteger(value)&&value>0,`Task 4 ${name} OID must be a positive safe integer`);
assert.equal(artifact.correctionRequests.length, artifact.manifest.correctionRequestCount);
assert.equal(artifact.postWatermarkRows.length, artifact.manifest.postWatermarkRowCount);
assert.equal(artifact.postWatermarkRows.length, artifact.manifest.replayRowCount, 'Every post-watermark row must be replayed');
assertHash(artifact.manifest.correctionAggregateChecksumSha256, 'Correction aggregate checksum');
assertHash(artifact.manifest.audit?.linkageChecksumSha256, 'Audit linkage checksum');
for (const row of artifact.correctionRequests) {
  assert.match(row.actorUserId || '', /^[a-f0-9-]{36}$/);
  assert.match(row.idempotencyKey || '', /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
  assert.deepEqual(JSON.parse(row.requestPayloadCanonical), row.requestPayload);
  assert.deepEqual(row.resultRowCanonical === null ? null : JSON.parse(row.resultRowCanonical), row.resultRow);
  const recomputed = sha256(retainedCorrectionText(row));
  assert.equal(row.currentChecksumSha256, recomputed, `Correction checksum mismatch for ${row.idempotencyKey}`);
}
assert.equal(
  sha256(artifact.correctionRequests.map((row) => `${row.actorUserId}:${row.idempotencyKey}:${row.currentChecksumSha256}`).sort().join('\n')),
  artifact.manifest.correctionAggregateChecksumSha256,
  'Correction aggregate checksum mismatch',
);
for (const row of artifact.postWatermarkRows) {
  assert.equal(row.disposition, 'replay', 'Generic rollback cannot delete post-watermark rows');
  assert.deepEqual(JSON.parse(row.rowCanonicalJson), row.row, `Canonical post-watermark row changed for ${row.id}`);
  assert.equal(row.currentChecksumSha256, sha256(row.rowCanonicalJson), `Post-watermark checksum mismatch for ${row.id}`);
}
const correctionPayload = Buffer.from(JSON.stringify(artifact.correctionRequests), 'utf8').toString('base64');

const downPath = new URL('../supabase/rollbacks/20260805120000_social_visibility_active_down.sql', import.meta.url);
const down = await readFile(downPath, 'utf8');
const ackSql = `
create temp table _social_rollback_evidence_ack (
  artifact_sha256 text not null,
  correction_request_count bigint not null,
  correction_aggregate_checksum_sha256 text not null,
  audit_batch_count bigint not null,
  audit_event_count bigint not null,
  audit_linkage_checksum_sha256 text not null,
  task4_table_oid oid not null,
  task4_apply_oid oid not null,
  task4_ingest_oid oid not null,
  correction_requests jsonb not null
) on commit drop;
insert into _social_rollback_evidence_ack values (
  '${claimedHash}',
  ${artifact.manifest.correctionRequestCount},
  '${artifact.manifest.correctionAggregateChecksumSha256}',
  ${artifact.manifest.audit.batchCount},
  ${artifact.manifest.audit.eventCount},
  '${artifact.manifest.audit.linkageChecksumSha256}',
  ${task4ObjectOids.social_correction_requests},
  ${task4ObjectOids.canary_apply_social_correction},
  ${task4ObjectOids.canary_ingest_social_thread},
  convert_from(decode('${correctionPayload}', 'base64'), 'UTF8')::jsonb
);
`;
assert.ok(down.includes('begin;'), 'Down migration transaction marker is absent');
const combined = down.replace('begin;', `begin;\n${ackSql}`);
await writeFile(output, combined, { mode: 0o600, flag: 'wx' });
console.log(`Verified rollback evidence and wrote transaction-bound down migration: artifact=${claimedHash}; output=${output}`);
