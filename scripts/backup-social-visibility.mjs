#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseSqlEditorExport, unwrapSingleSqlEditorValue } from './lib/sql-editor-input.mjs';

const argv = process.argv.slice(2);
const get = (name) => { const i = argv.indexOf(`--${name}`); return i < 0 ? undefined : argv[i + 1]; };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonicalJson = (value) => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
const fields = ['id','district_id','relationship_type','visibility_status','review_version','reviewed_at','reviewed_by','created_at','updated_at'];
const canonicalRowText = (row) => fields.map((field) => {
  const value = row[field] === null || row[field] === undefined ? '<NULL>' : String(row[field]);
  return `${Buffer.byteLength(value, 'utf8')}:${value}`;
}).join('|');
const rowChecksum = (row) => sha256(canonicalRowText(row));

const normalizeSqlEditorInput = (value) => unwrapSingleSqlEditorValue(value, 'social_visibility_backup');

function psqlEnvironment(databaseUrl) {
  const parsed = new URL(databaseUrl);
  assert.match(parsed.protocol, /^postgres(ql)?:$/);
  return { ...process.env, PGHOST: parsed.hostname, PGPORT: parsed.port || '5432', PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)), PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password), ...(parsed.searchParams.get('sslmode') ? { PGSSLMODE: parsed.searchParams.get('sslmode') } : {}) };
}

const exportSql = `
begin transaction isolation level repeatable read read only;
select jsonb_build_object(
  'watermark', to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'rows', coalesce(jsonb_agg(jsonb_build_object(
    'id',id::text,'district_id',district_id,'relationship_type',relationship_type,
    'visibility_status',visibility_status,'review_version',review_version,
    'reviewed_at',case when reviewed_at is null then null else to_char(reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'reviewed_by',reviewed_by::text,
    'created_at',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'updated_at',to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ) order by id),'[]'::jsonb)
) from public.social_threads;
commit;`;

if (get('sql-output')) {
  await writeFile(get('sql-output'), exportSql, { mode: 0o600, flag: 'wx' });
  console.log(`Wrote read-only Social visibility export SQL: ${get('sql-output')}`);
  process.exit(0);
}

let source;
if (get('input')) source = normalizeSqlEditorInput(parseSqlEditorExport(await readFile(get('input'), 'utf8'), 'social_visibility_backup'));
else {
  const databaseUrl = get('database-url') || process.env.DATABASE_URL;
  assert.ok(databaseUrl, 'Provide --input from SQL Editor, --database-url, DATABASE_URL, or --sql-output');
  const result = spawnSync(process.env.PSQL_BIN || 'psql', ['-X','-qAt','-v','ON_ERROR_STOP=1'], { input: exportSql, encoding: 'utf8', env: psqlEnvironment(databaseUrl), maxBuffer: 128 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr.trim() || 'psql backup failed');
  const start=result.stdout.indexOf('{'), end=result.stdout.lastIndexOf('}');
  assert.ok(start >= 0 && end >= start, 'psql did not return backup JSON');
  source=normalizeSqlEditorInput(JSON.parse(result.stdout.slice(start,end+1)));
}
assert.ok(Array.isArray(source.rows), 'Backup input must contain rows[]');
assert.match(source.watermark, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/, 'Backup watermark must be canonical UTC');
const ids = new Set();
const rows = source.rows.map((row) => {
  for (const field of fields) assert.ok(Object.hasOwn(row, field), `Backup row is missing ${field}`);
  assert.ok(!ids.has(row.id), `Duplicate Social id ${row.id}`); ids.add(row.id);
  assert.ok(['review','approved','active','excluded'].includes(row.visibility_status), `Unsupported N-1 status ${row.visibility_status}`);
  return { ...Object.fromEntries(fields.map((field) => [field, row[field]])), canonical_checksum_sha256: rowChecksum(row) };
}).sort((a,b) => a.id.localeCompare(b.id));

let schemaIdentity = get('schema-identity');
let schemaFingerprint = get('schema-fingerprint');
let expectedRowCount;
let schemaContractArtifactSha256;
let migrationStateIdentity;
let verificationMode;
const unsafeDevelopmentMode = argv.includes('--unsafe-dev-schema-assertions');
if (get('schema-contract')) {
  const schemaArtifact = JSON.parse(await readFile(get('schema-contract'), 'utf8'));
  assert.equal(schemaArtifact.format, 'canary-social-schema-contract/v1', 'Unsupported schema contract artifact');
  const claimedSchemaHash = schemaArtifact.artifactSha256;
  assert.match(claimedSchemaHash || '', /^[a-f0-9]{64}$/, 'Schema contract artifact SHA-256 is invalid');
  assert.equal(
    sha256(canonicalJson({ ...schemaArtifact, artifactSha256: null })),
    claimedSchemaHash,
    'Schema contract artifact SHA-256 mismatch',
  );
  assert.equal(
    schemaArtifact.migrationStateIdentity,
    'task5-n-1',
    'Production visibility backups require the exact task5-n-1 migration-state contract',
  );
  assert.equal(schemaArtifact.contract?.migration_state_identity, 'task5-n-1', 'Schema contract identity is inconsistent');
  schemaIdentity = schemaArtifact.contract?.schema_identity;
  schemaFingerprint = schemaArtifact.contract?.schema_fingerprint_md5;
  const contractRowCount = schemaArtifact.contract?.row_count;
  assert.ok(Number.isSafeInteger(contractRowCount) && contractRowCount >= 0, 'Schema contract row count is invalid');
  assert.equal(rows.length, contractRowCount, 'Backup rows do not match schema contract row count');
  expectedRowCount = contractRowCount;
  schemaContractArtifactSha256 = claimedSchemaHash;
  migrationStateIdentity = schemaArtifact.migrationStateIdentity;
  verificationMode = 'production-sealed-schema-contract';
}
const explicitExpectedRowCount = get('expected-row-count');
if (explicitExpectedRowCount !== undefined) {
  assert.ok(unsafeDevelopmentMode, '--expected-row-count is unsafe and requires --unsafe-dev-schema-assertions');
  assert.match(explicitExpectedRowCount, /^(0|[1-9]\d*)$/, '--expected-row-count must be a non-negative integer');
  const parsedExpectedRowCount = Number(explicitExpectedRowCount);
  assert.ok(Number.isSafeInteger(parsedExpectedRowCount), '--expected-row-count exceeds the safe integer range');
  assert.equal(rows.length, parsedExpectedRowCount, 'Backup rows do not match expected row count');
  if (expectedRowCount !== undefined) {
    assert.equal(parsedExpectedRowCount, expectedRowCount, '--expected-row-count does not match schema contract row count');
  }
  expectedRowCount = parsedExpectedRowCount;
}
if (!get('schema-contract')) {
  assert.ok(unsafeDevelopmentMode, 'Production backups require --schema-contract; use --unsafe-dev-schema-assertions only for disposable development fixtures');
  verificationMode = 'unsafe-development-only';
}
assert.notEqual(expectedRowCount, undefined, 'Provide --schema-contract or --expected-row-count to prove backup completeness');
assert.equal(schemaIdentity, 'canary-social-visibility-v2', 'A verified Social schema identity is required');
assert.match(schemaFingerprint || '', /^[a-f0-9]{32}$/, 'A verified schema fingerprint is required');
const aggregateChecksum = sha256(rows.map((row) => `${row.id}:${row.canonical_checksum_sha256}`).join('\n'));
const artifact = {
  format: 'canary-social-visibility-backup/v1',
  manifest: { watermark: source.watermark, rowCount: rows.length, expectedRowCount, aggregateChecksumSha256: aggregateChecksum, schemaIdentity, migrationStateIdentity: migrationStateIdentity || null, schemaFingerprintMd5: schemaFingerprint, schemaContractArtifactSha256: schemaContractArtifactSha256 || null, verificationMode, artifactSha256: null },
  rows,
};
artifact.manifest.artifactSha256 = sha256(canonicalJson(artifact));
const output = get('output');
assert.ok(output, '--output is required (choose a protected caller-controlled path)');
await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(`Wrote ${rows.length} Social visibility rows; verification=${verificationMode}; watermark=${source.watermark}; aggregate=${aggregateChecksum}; artifact=${artifact.manifest.artifactSha256}; output=${output}`);
