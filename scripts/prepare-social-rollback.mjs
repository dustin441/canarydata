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
const artifactPath = get('evidence-artifact');
const output = get('sql-output');
assert.ok(artifactPath && output, '--evidence-artifact and --sql-output are required');
const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
assert.equal(artifact.format, 'canary-social-rollback-evidence/v1');
const claimedHash = artifact.manifest?.artifactSha256;
assert.match(claimedHash || '', /^[a-f0-9]{64}$/);
artifact.manifest.artifactSha256 = null;
assert.equal(sha256(canonicalJson(artifact)), claimedHash, 'Rollback evidence artifact SHA-256 mismatch');
artifact.manifest.artifactSha256 = claimedHash;
assert.equal(artifact.correctionRequests.length, artifact.manifest.correctionRequestCount);
assert.equal(artifact.postWatermarkRows.length, artifact.manifest.postWatermarkRowCount);
assert.match(artifact.manifest.correctionAggregateChecksumSha256 || '', /^[a-f0-9]{64}$/);
assert.match(artifact.manifest.audit?.linkageChecksumSha256 || '', /^[a-f0-9]{64}$/);
for (const row of artifact.correctionRequests) assert.match(row.currentChecksumSha256 || '', /^[a-f0-9]{64}$/);

const downPath = new URL('../supabase/rollbacks/20260805120000_social_visibility_active_down.sql', import.meta.url);
const down = await readFile(downPath, 'utf8');
const ackSql = `
create temp table _social_rollback_evidence_ack (
  artifact_sha256 text not null,
  correction_request_count bigint not null,
  correction_aggregate_checksum_sha256 text not null,
  audit_batch_count bigint not null,
  audit_event_count bigint not null,
  audit_linkage_checksum_sha256 text not null
) on commit drop;
insert into _social_rollback_evidence_ack values (
  '${claimedHash}',
  ${artifact.manifest.correctionRequestCount},
  '${artifact.manifest.correctionAggregateChecksumSha256}',
  ${artifact.manifest.audit.batchCount},
  ${artifact.manifest.audit.eventCount},
  '${artifact.manifest.audit.linkageChecksumSha256}'
);
`;
assert.ok(down.includes('begin;'), 'Down migration transaction marker is absent');
const combined = down.replace('begin;', `begin;\n${ackSql}`);
await writeFile(output, combined, { mode: 0o600, flag: 'wx' });
console.log(`Verified rollback evidence and wrote transaction-bound down migration: artifact=${claimedHash}; output=${output}`);
