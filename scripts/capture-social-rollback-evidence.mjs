#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseSqlEditorExport, unwrapSingleSqlEditorValue } from './lib/sql-editor-input.mjs';

const TOOL_VERSION = '1.0.0';
const argv = process.argv.slice(2);
const get = (name) => { const index = argv.indexOf(`--${name}`); return index < 0 ? undefined : argv[index + 1]; };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonicalJson = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;

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
const visibilityHash = visibility.manifest.artifactSha256;
assert.match(visibilityHash || '', /^[a-f0-9]{64}$/);
visibility.manifest.artifactSha256 = null;
assert.equal(sha256(canonicalJson(visibility)), visibilityHash, 'Visibility backup artifact SHA-256 mismatch');
visibility.manifest.artifactSha256 = visibilityHash;
assert.equal(source.watermark, visibility.manifest.watermark, 'Rollback evidence watermark must match the visibility backup');
assert.match(source.capturedAt || '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
assert.ok(Array.isArray(source.correctionRequests));
assert.ok(Array.isArray(source.postWatermarkRows));
assert.ok(source.audit && Number.isSafeInteger(source.audit.batchCount) && Number.isSafeInteger(source.audit.eventCount));
assert.match(source.audit.linkageChecksumSha256 || '', /^[a-f0-9]{64}$/);

const correctionKeys = new Set();
for (const request of source.correctionRequests) {
  for (const field of ['actorUserId', 'idempotencyKey', 'requestPayload', 'resultRow', 'createdAt', 'completedAt', 'currentChecksumSha256']) {
    assert.ok(Object.hasOwn(request, field), `Correction request is missing ${field}`);
  }
  assert.match(request.currentChecksumSha256, /^[a-f0-9]{64}$/);
  const key = `${request.actorUserId}:${request.idempotencyKey}`;
  assert.ok(!correctionKeys.has(key), `Duplicate correction request ${key}`);
  correctionKeys.add(key);
}

const qaManifestPath = get('qa-fixture-manifest');
const qaManifest = qaManifestPath ? JSON.parse(await readFile(qaManifestPath, 'utf8')) : { fixtures: [] };
assert.ok(Array.isArray(qaManifest.fixtures), 'QA fixture manifest must contain fixtures[]');
const fixtures = new Map(qaManifest.fixtures.map((fixture) => {
  assert.deepEqual(Object.keys(fixture).sort(), ['currentChecksumSha256', 'fixtureMarker', 'id', 'tenant'].sort());
  assert.match(fixture.currentChecksumSha256 || '', /^[a-f0-9]{64}$/);
  assert.match(fixture.fixtureMarker || '', /^controlled-qa:[A-Za-z0-9._:-]{1,100}$/);
  return [fixture.id, fixture];
}));
const rowIds = new Set();
const postWatermarkRows = source.postWatermarkRows.map((entry) => {
  for (const field of ['id', 'tenant', 'sourceIdentity', 'idempotencyKey', 'row', 'currentChecksumSha256', 'auditEventIds', 'auditBatchIds']) {
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
  assert.match(entry.currentChecksumSha256, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(entry.auditEventIds) && Array.isArray(entry.auditBatchIds));
  const fixture = fixtures.get(entry.id);
  if (!fixture) return { ...entry, disposition: 'replay' };
  assert.equal(fixture.tenant, entry.tenant, `QA fixture tenant mismatch for ${entry.id}`);
  assert.equal(fixture.currentChecksumSha256, entry.currentChecksumSha256, `QA fixture checksum mismatch for ${entry.id}`);
  assert.equal(entry.row.provider_metadata?.rollback_fixture_marker, fixture.fixtureMarker, `QA fixture marker mismatch for ${entry.id}`);
  fixtures.delete(entry.id);
  return { ...entry, disposition: 'delete_qa_fixture', fixtureMarker: fixture.fixtureMarker };
});
assert.equal(fixtures.size, 0, 'QA fixture manifest references a row outside the post-watermark change set');

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
    qaFixtureDeleteCount: postWatermarkRows.filter((row) => row.disposition === 'delete_qa_fixture').length,
    audit: source.audit,
    artifactSha256: null,
  },
  correctionRequests: source.correctionRequests,
  postWatermarkRows,
};
artifact.manifest.artifactSha256 = sha256(canonicalJson(artifact));
await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(`Wrote rollback evidence: corrections=${artifact.manifest.correctionRequestCount}; post-watermark=${artifact.manifest.postWatermarkRowCount}; artifact=${artifact.manifest.artifactSha256}; output=${output}`);
