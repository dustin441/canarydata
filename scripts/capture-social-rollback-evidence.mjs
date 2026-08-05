#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseSqlEditorExport, unwrapSingleSqlEditorValue } from './lib/sql-editor-input.mjs';

const TOOL_VERSION = '2.0.0';
const argv = process.argv.slice(2);
const get = (name) => { const index = argv.indexOf(`--${name}`); return index < 0 ? undefined : argv[index + 1]; };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonicalJson = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
const retainedCorrectionText = (request) => [
  request.actorUserId,
  request.idempotencyKey,
  request.requestPayloadCanonical,
  request.resultRowCanonical,
  request.createdAt,
  request.completedAt,
].map((raw) => {
  const value = raw === null ? '<NULL>' : raw;
  return `${Buffer.byteLength(value, 'utf8')}:${value}`;
}).join('|');

const input = get('input');
const visibilityPath = get('visibility-backup');
const output = get('output');
assert.ok(input && visibilityPath && output, '--input, --visibility-backup, and --output are required');
const source = unwrapSingleSqlEditorValue(
  parseSqlEditorExport(await readFile(input, 'utf8'), 'social_rollback_evidence'),
  'social_rollback_evidence',
);
const visibility = JSON.parse(await readFile(visibilityPath, 'utf8'));
assert.equal(visibility.format, 'canary-social-visibility-backup/v1', 'Unsupported visibility backup');
assert.equal(visibility.manifest.verificationMode, 'production-sealed-schema-contract', 'Rollback evidence requires a production-sealed visibility backup');
assert.equal(visibility.manifest.migrationStateIdentity, 'task5-n-1', 'Rollback evidence requires an exact task5-n-1 visibility backup');
const visibilityHash = visibility.manifest.artifactSha256;
assert.match(visibilityHash || '', /^[a-f0-9]{64}$/);
visibility.manifest.artifactSha256 = null;
assert.equal(sha256(canonicalJson(visibility)), visibilityHash, 'Visibility backup artifact SHA-256 mismatch');
visibility.manifest.artifactSha256 = visibilityHash;
assert.equal(source.watermark, visibility.manifest.watermark, 'Rollback evidence watermark must match the visibility backup');
assert.match(source.capturedAt || '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
assert.ok(Array.isArray(source.correctionRequests));
assert.ok(Array.isArray(source.postWatermarkRows));
assert.ok(source.audit && Number.isSafeInteger(source.audit.batchCount) && source.audit.batchCount >= 0);
assert.ok(Number.isSafeInteger(source.audit.eventCount) && source.audit.eventCount >= 0);
assert.match(source.audit.linkageChecksumSha256 || '', /^[a-f0-9]{64}$/);

const correctionKeys = new Set();
for (const request of source.correctionRequests) {
  for (const field of ['actorUserId', 'idempotencyKey', 'requestPayload', 'resultRow', 'createdAt', 'completedAt', 'requestPayloadCanonical', 'resultRowCanonical', 'retainedRow', 'currentChecksumSha256', 'auditEventIds', 'auditBatchIds']) {
    assert.ok(Object.hasOwn(request, field), `Correction request is missing ${field}`);
  }
  assert.deepEqual(request.retainedRow, {
    actor_user_id: request.actorUserId,
    idempotency_key: request.idempotencyKey,
    request_payload: request.requestPayload,
    result_row: request.resultRow,
    created_at: request.createdAt,
    completed_at: request.completedAt,
  }, `Correction request retained content mapping changed for ${request.idempotencyKey}`);
  assert.deepEqual(JSON.parse(request.requestPayloadCanonical), request.requestPayload, 'Canonical correction request payload changed');
  assert.deepEqual(request.resultRowCanonical === null ? null : JSON.parse(request.resultRowCanonical), request.resultRow, 'Canonical correction result changed');
  const recomputedChecksum = sha256(retainedCorrectionText(request));
  assert.equal(request.currentChecksumSha256, recomputedChecksum, `Correction request retained checksum mismatch for ${request.idempotencyKey}`);
  assert.ok(Array.isArray(request.auditEventIds) && Array.isArray(request.auditBatchIds));
  assert.match(request.actorUserId || '', /^[a-f0-9-]{36}$/);
  assert.match(request.idempotencyKey || '', /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
  assert.match(request.createdAt || '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
  if (request.completedAt === null) {
    assert.equal(request.resultRow, null, 'Incomplete correction cannot contain a result');
    assert.deepEqual(request.auditEventIds, []);
    assert.deepEqual(request.auditBatchIds, []);
  } else {
    assert.match(request.completedAt || '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
    assert.ok(request.resultRow && typeof request.resultRow === 'object');
    assert.equal(request.requestPayload?.social_thread_id, request.resultRow.id, 'Correction result is not source-bound to its requested row');
    assert.equal(request.requestPayload?.expected_district_id, request.resultRow.district_id, 'Correction result district is not source-bound');
    assert.equal(request.resultRow.reviewed_by, request.actorUserId, 'Correction result reviewer is not the request actor');
    assert.equal(request.resultRow.review_version, request.requestPayload.expected_version + 1, 'Correction result version is not the requested successor');
    assert.equal(request.resultRow.visibility_status, request.requestPayload.action === 'exclude' ? 'excluded' : 'active', 'Correction result status does not match its action');
    assert.equal(request.auditEventIds.length, 1, 'Completed correction must have one sealed audit event');
    assert.equal(request.auditBatchIds.length, 1, 'Completed correction must have one sealed audit batch');
  }
  const key = `${request.actorUserId}:${request.idempotencyKey}`;
  assert.ok(!correctionKeys.has(key), `Duplicate correction request ${key}`);
  correctionKeys.add(key);
}

assert.equal(get('qa-fixture-manifest'), undefined, 'Generic production rollback does not accept QA deletion manifests');
const rowIds = new Set();
const postWatermarkRows = source.postWatermarkRows.map((entry) => {
  for (const field of ['id', 'tenant', 'sourceIdentity', 'idempotencyKey', 'row', 'rowCanonicalJson', 'currentChecksumSha256', 'auditEventIds', 'auditBatchIds']) {
    assert.ok(Object.hasOwn(entry, field), `Post-watermark row is missing ${field}`);
  }
  assert.ok(!rowIds.has(entry.id), `Duplicate post-watermark row ${entry.id}`);
  rowIds.add(entry.id);
  assert.equal(entry.tenant, entry.row.district_id);
  assert.equal(entry.id, entry.row.id);
  assert.deepEqual(entry.sourceIdentity, {
    district_id: entry.row.district_id,
    provider: entry.row.provider,
    platform: entry.row.platform,
    external_thread_id: entry.row.external_thread_id,
  });
  assert.match(entry.idempotencyKey, /^rollback-replay:[a-f0-9-]{36}$/);
  assert.deepEqual(JSON.parse(entry.rowCanonicalJson), entry.row, `Post-watermark canonical row changed for ${entry.id}`);
  assert.equal(entry.currentChecksumSha256, sha256(entry.rowCanonicalJson), `Post-watermark retained row checksum mismatch for ${entry.id}`);
  assert.ok(Array.isArray(entry.auditEventIds) && Array.isArray(entry.auditBatchIds));
  return { ...entry, disposition: 'replay' };
});

const correctionAggregateChecksumSha256 = sha256(source.correctionRequests
  .map((row) => `${row.actorUserId}:${row.idempotencyKey}:${row.currentChecksumSha256}`)
  .sort().join('\n'));
const artifact = {
  format: 'canary-social-rollback-evidence/v1',
  tool: { name: 'capture-social-rollback-evidence.mjs', version: TOOL_VERSION },
  manifest: {
    watermark: source.watermark,
    capturedAt: source.capturedAt,
    visibilityBackupArtifactSha256: visibilityHash,
    correctionRequestCount: source.correctionRequests.length,
    correctionAggregateChecksumSha256,
    postWatermarkRowCount: postWatermarkRows.length,
    replayRowCount: postWatermarkRows.filter((row) => row.disposition === 'replay').length,

    audit: source.audit,
    artifactSha256: null,
  },
  correctionRequests: source.correctionRequests,
  postWatermarkRows,
};
artifact.manifest.artifactSha256 = sha256(canonicalJson(artifact));
await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(`Wrote rollback evidence: corrections=${artifact.manifest.correctionRequestCount}; post-watermark=${artifact.manifest.postWatermarkRowCount}; artifact=${artifact.manifest.artifactSha256}; output=${output}`);
