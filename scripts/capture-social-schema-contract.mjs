#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith('--') ? [value.slice(2), all[index + 1]?.startsWith('--') ? true : all[index + 1]] : [Symbol(), value]));
const sqlPath = new URL('../supabase/verify_social_visibility_contract.sql', import.meta.url);
const sql = await readFile(sqlPath, 'utf8');
const canonicalJson = (value) => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function psqlEnvironment(databaseUrl) {
  const parsed = new URL(databaseUrl);
  assert.match(parsed.protocol, /^postgres(ql)?:$/, 'DATABASE_URL must use postgres:// or postgresql://');
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    ...(parsed.searchParams.get('sslmode') ? { PGSSLMODE: parsed.searchParams.get('sslmode') } : {}),
  };
}

function parseContract(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  assert.ok(start >= 0 && end >= start, 'Input did not contain a contract JSON object');
  const parsed = JSON.parse(text.slice(start, end + 1));
  assert.equal(parsed.schema_identity, 'canary-social-visibility-v2');
  assert.match(parsed.schema_fingerprint_md5, /^[a-f0-9]{32}$/);
  return parsed;
}

function parseArtifact(text, label) {
  const artifact = JSON.parse(text);
  assert.equal(artifact.format, 'canary-social-schema-contract/v1', `${label} has an unsupported format`);
  const claimedHash = artifact.artifactSha256;
  assert.match(claimedHash || '', /^[a-f0-9]{64}$/, `${label} has an invalid artifact SHA-256`);
  assert.equal(
    sha256(canonicalJson({ ...artifact, artifactSha256: null })),
    claimedHash,
    `${label} artifact SHA-256 mismatch`,
  );
  return artifact;
}

if (args['sql-output']) {
  await writeFile(args['sql-output'], sql);
  console.log(`Wrote read-only Social contract SQL: ${args['sql-output']}`);
  process.exit(0);
}

if (args.compare) {
  assert.ok(args.with, '--compare requires --with');
  const [left, right] = await Promise.all([readFile(args.compare, 'utf8'), readFile(args.with, 'utf8')]);
  const a = parseArtifact(left, '--compare'); const b = parseArtifact(right, '--with');
  assert.equal(a.contract.schema_fingerprint_md5, b.contract.schema_fingerprint_md5, 'Schema fingerprints differ');
  assert.deepEqual(a.contract.status_counts, b.contract.status_counts, 'Status counts differ');
  assert.equal(a.contract.official_report_set_md5, b.contract.official_report_set_md5, 'Official report sets differ');
  console.log('Social contract artifacts match: schema, statuses, and official report set.');
  process.exit(0);
}

let raw;
if (args.input) raw = await readFile(args.input, 'utf8');
else {
  const databaseUrl = args['database-url'] || process.env.DATABASE_URL;
  assert.ok(databaseUrl, 'Provide --input from SQL Editor, --database-url, DATABASE_URL, or --sql-output');
  const result = spawnSync(process.env.PSQL_BIN || 'psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    input: sql, encoding: 'utf8', env: psqlEnvironment(databaseUrl), maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr.trim() || 'psql contract capture failed');
  raw = result.stdout;
}
const contract = parseContract(raw);
const artifact = {
  format: 'canary-social-schema-contract/v1',
  capturedBy: 'scripts/capture-social-schema-contract.mjs',
  contract,
};
artifact.artifactSha256 = sha256(canonicalJson({ ...artifact, artifactSha256: null }));
const output = args.output || `social-schema-contract-${Date.now()}.json`;
await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
console.log(`Wrote Social schema contract (${artifact.artifactSha256}): ${output}`);
