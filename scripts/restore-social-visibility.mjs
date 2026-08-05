#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const get = (name) => { const i = argv.indexOf(`--${name}`); return i < 0 ? undefined : argv[i + 1]; };
const has = (name) => argv.includes(`--${name}`);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonicalJson = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
const fields = ['id','district_id','relationship_type','visibility_status','review_version','reviewed_at','reviewed_by','created_at','updated_at'];
const rowText = (row) => fields.map((field) => {
  const value = row[field] === null || row[field] === undefined ? '<NULL>' : String(row[field]);
  return `${Buffer.byteLength(value, 'utf8')}:${value}`;
}).join('|');
const rowChecksum = (row) => sha256(rowText(row));

function psqlEnvironment(databaseUrl) {
  const parsed = new URL(databaseUrl);
  assert.match(parsed.protocol, /^postgres(ql)?:$/);
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

const artifactPath = get('artifact');
assert.ok(artifactPath, '--artifact is required');
const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
assert.equal(artifact.format, 'canary-social-visibility-backup/v1');
assert.equal(artifact.manifest.schemaIdentity, 'canary-social-visibility-v2');
assert.equal(artifact.manifest.verificationMode, 'production-sealed-schema-contract', 'Rollback requires a production-sealed backup');
assert.match(artifact.manifest.schemaContractArtifactSha256 || '', /^[a-f0-9]{64}$/, 'Backup schema-contract artifact hash is invalid');
assert.match(artifact.manifest.schemaFingerprintMd5 || '', /^[a-f0-9]{32}$/, 'Backup schema fingerprint is invalid');
assert.match(artifact.manifest.watermark || '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/, 'Backup watermark is invalid');
const claimedArtifactHash = artifact.manifest.artifactSha256;
assert.match(claimedArtifactHash || '', /^[a-f0-9]{64}$/, 'Backup artifact SHA-256 is invalid');
artifact.manifest.artifactSha256 = null;
assert.equal(sha256(canonicalJson(artifact)), claimedArtifactHash, 'Backup artifact SHA-256 mismatch');
artifact.manifest.artifactSha256 = claimedArtifactHash;
assert.ok(Array.isArray(artifact.rows), 'Backup rows[] is required');
assert.equal(artifact.rows.length, artifact.manifest.rowCount, 'Backup row count mismatch');
assert.equal(artifact.manifest.rowCount, artifact.manifest.expectedRowCount, 'Backup expected row count mismatch');
const backupIds = new Set();
for (const row of artifact.rows) {
  assert.ok(!backupIds.has(row.id), `Duplicate backup row ${row.id}`);
  backupIds.add(row.id);
  assert.equal(rowChecksum(row), row.canonical_checksum_sha256, `Corrupt backup row ${row.id}`);
}
assert.equal(
  sha256([...artifact.rows].sort((a, b) => a.id.localeCompare(b.id)).map((row) => `${row.id}:${row.canonical_checksum_sha256}`).join('\n')),
  artifact.manifest.aggregateChecksumSha256,
  'Backup aggregate checksum mismatch',
);

const evidencePath = get('rollback-evidence');
assert.ok(evidencePath, '--rollback-evidence is required');
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
assert.equal(evidence.format, 'canary-social-rollback-evidence/v1');
const claimedEvidenceHash = evidence.manifest?.artifactSha256;
assert.match(claimedEvidenceHash || '', /^[a-f0-9]{64}$/);
evidence.manifest.artifactSha256 = null;
assert.equal(sha256(canonicalJson(evidence)), claimedEvidenceHash, 'Rollback evidence artifact SHA-256 mismatch');
evidence.manifest.artifactSha256 = claimedEvidenceHash;
assert.equal(evidence.manifest.visibilityBackupArtifactSha256, claimedArtifactHash, 'Rollback evidence belongs to a different visibility backup');
assert.equal(evidence.manifest.watermark, artifact.manifest.watermark, 'Rollback evidence watermark mismatch');
assert.ok(Array.isArray(evidence.postWatermarkRows), 'Rollback evidence must contain postWatermarkRows[]');
assert.equal(evidence.postWatermarkRows.length, evidence.manifest.postWatermarkRowCount);
assert.ok(Number.isSafeInteger(evidence.manifest.audit?.batchCount) && Number.isSafeInteger(evidence.manifest.audit?.eventCount));
assert.match(evidence.manifest.audit?.linkageChecksumSha256 || '', /^[a-f0-9]{64}$/);
const reconciledIds = new Set();
for (const row of evidence.postWatermarkRows) {
  assert.ok(['replay', 'delete_qa_fixture'].includes(row.disposition), 'Unsupported post-watermark disposition');
  assert.match(row.currentChecksumSha256 || '', /^[a-f0-9]{64}$/);
  assert.match(row.idempotencyKey || '', /^rollback-replay:[a-f0-9-]{36}$/);
  assert.equal(row.id, row.row?.id);
  assert.equal(row.tenant, row.row?.district_id);
  assert.deepEqual(row.sourceIdentity, {
    district_id: row.row.district_id,
    provider: row.row.provider,
    platform: row.row.platform,
    external_thread_id: row.row.external_thread_id,
  });
  assert.ok(Array.isArray(row.auditEventIds) && Array.isArray(row.auditBatchIds));
  if (row.disposition === 'delete_qa_fixture') {
    assert.match(row.fixtureMarker || '', /^controlled-qa:[A-Za-z0-9._:-]{1,100}$/);
    assert.equal(row.row.provider_metadata?.rollback_fixture_marker, row.fixtureMarker);
    assert.equal(row.auditEventIds.length, 0, 'A QA fixture with audit events cannot be deleted');
  }
  assert.ok(!reconciledIds.has(row.id), `Duplicate reconciled row ${row.id}`);
  assert.ok(!backupIds.has(row.id), `Reconciled row ${row.id} is already in the backup`);
  reconciledIds.add(row.id);
}
const restoreRows = artifact.rows.map((row) => ({
  ...row,
  expected_n_checksum_sha256: rowChecksum({
    ...row,
    visibility_status: ['review', 'approved'].includes(row.visibility_status) ? 'active' : row.visibility_status,
  }),
}));
const payload = Buffer.from(JSON.stringify({ manifest: artifact.manifest, rows: restoreRows, evidence }), 'utf8').toString('base64');

const sql = `-- Generated by restore-social-visibility.mjs. Contains no credentials.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('canary-social-visibility-v2', 0));
lock table public.social_threads in share row exclusive mode;
lock table public.social_review_batches in share mode;
lock table public.social_review_events in share mode;

create temp table _social_restore_payload(doc jsonb) on commit drop;
insert into _social_restore_payload values (convert_from(decode('${payload}', 'base64'), 'UTF8')::jsonb);
create temp table _social_restore_rows on commit drop as
select * from jsonb_to_recordset((select doc->'rows' from _social_restore_payload)) as x(
  id uuid, district_id text, relationship_type text, visibility_status text, review_version integer,
  reviewed_at text, reviewed_by uuid, created_at text, updated_at text,
  canonical_checksum_sha256 text, expected_n_checksum_sha256 text
);
create temp table _social_reconciled(entry jsonb) on commit drop;
insert into _social_reconciled
select value from jsonb_array_elements((select doc->'evidence'->'postWatermarkRows' from _social_restore_payload));

create function pg_temp.social_row_checksum(t public.social_threads)
returns text language sql stable as $fn$
  select encode(digest(concat_ws('|',
    octet_length(t.id::text)::text || ':' || t.id::text,
    octet_length(t.district_id)::text || ':' || t.district_id,
    octet_length(t.relationship_type)::text || ':' || t.relationship_type,
    octet_length(t.visibility_status)::text || ':' || t.visibility_status,
    octet_length(t.review_version::text)::text || ':' || t.review_version::text,
    case when t.reviewed_at is null then '6:<NULL>' else octet_length(to_char(t.reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text || ':' || to_char(t.reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    case when t.reviewed_by is null then '6:<NULL>' else octet_length(t.reviewed_by::text)::text || ':' || t.reviewed_by::text end,
    octet_length(to_char(t.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text || ':' || to_char(t.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    octet_length(to_char(t.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text || ':' || to_char(t.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ), 'sha256'), 'hex')
$fn$;

create temp table _social_replay_results(id uuid primary key, idempotency_key text unique, mapped_status text) on commit drop;
create function pg_temp.canary_replay_social_thread_n1(p_entry jsonb)
returns uuid language plpgsql as $writer$
declare current_row public.social_threads%rowtype;
begin
  if p_entry->>'disposition' <> 'replay'
     or p_entry->>'idempotencyKey' !~ '^rollback-replay:[a-f0-9-]{36}$' then
    raise exception 'Invalid N-1 replay request';
  end if;
  select * into strict current_row from public.social_threads
  where district_id=p_entry->'sourceIdentity'->>'district_id'
    and provider=p_entry->'sourceIdentity'->>'provider'
    and platform=p_entry->'sourceIdentity'->>'platform'
    and external_thread_id=p_entry->'sourceIdentity'->>'external_thread_id'
  for update;
  if current_row.id::text <> p_entry->>'id'
     or to_jsonb(current_row) <> p_entry->'row'
     or encode(digest(convert_to(to_jsonb(current_row)::text, 'UTF8'), 'sha256'), 'hex') <> p_entry->>'currentChecksumSha256'
     or current_row.visibility_status not in ('active','excluded') then
    raise exception 'Post-watermark replay source identity or checksum changed';
  end if;
  update public.social_threads
  set visibility_status=case when current_row.visibility_status='active' then 'review' else 'excluded' end
  where id=current_row.id;
  insert into _social_replay_results values (
    current_row.id, p_entry->>'idempotencyKey',
    case when current_row.visibility_status='active' then 'review' else 'excluded' end
  );
  return current_row.id;
end
$writer$;

do $guard$
declare
  watermark timestamptz := ((select doc->'manifest'->>'watermark' from _social_restore_payload))::timestamptz;
begin
  if to_regclass('public.social_correction_requests') is not null
     or to_regprocedure('public.canary_apply_social_correction(uuid,text,uuid,text,integer,text)') is not null
     or to_regprocedure('public.canary_ingest_social_thread(jsonb)') is not null then
    raise exception 'Run the Task 5 down migration before row restoration';
  end if;
  if (select md5(pg_get_functiondef('public.canary_review_social_thread(uuid,uuid,text,integer,text,text)'::regprocedure))) <> 'c4f851bf607f11545d47ef2b04b29740'
     or (select md5(pg_get_functiondef('public.canary_bulk_review_social_threads(uuid,text,uuid[],text)'::regprocedure))) <> '8bd52d87cc68594f993f0e8f4b7c29bb'
     or (select md5(pg_get_functiondef('public.canary_assert_social_reviewer(uuid)'::regprocedure))) <> 'f8acecd019a7182f9394ca2ce1d78a67'
     or (select md5(pg_get_functiondef('public.prevent_social_review_audit_mutation()'::regprocedure))) <> '7f325916f94da40cbf15014e320345d6'
     or (select md5(pg_get_functiondef('public.touch_social_updated_at()'::regprocedure))) <> 'feff1b4a6c026311cd0a6164d5f96a65' then
    raise exception 'Exact captured production N-1 function contract is absent';
  end if;
  if (select count(*) from _social_restore_rows) <> (select (doc->'manifest'->>'rowCount')::bigint from _social_restore_payload)
     or (select count(*) from _social_restore_rows) <> (select count(distinct id) from _social_restore_rows)
     or (select count(*) from _social_reconciled) <> (select count(distinct entry->>'id') from _social_reconciled) then
    raise exception 'Restore payload count or identity mismatch';
  end if;
  if exists (
    select 1 from _social_restore_rows b
    left join public.social_threads t on t.id = b.id
    where t.id is null or t.district_id <> b.district_id or pg_temp.social_row_checksum(t) <> b.expected_n_checksum_sha256
  ) then
    raise exception 'Pre-watermark Social rows are missing or changed beyond the deterministic N mapping';
  end if;
  if exists (
    select 1 from public.social_threads t
    left join _social_restore_rows b on b.id = t.id
    where b.id is null and t.created_at <= watermark
  ) then
    raise exception 'Unexpected row at or before the backup watermark';
  end if;
  if exists (
    select 1 from public.social_threads t
    left join _social_restore_rows b on b.id = t.id
    left join _social_reconciled r on r.entry->>'id' = t.id::text
    where b.id is null and r.entry is null
  ) then
    raise exception 'Unresolved post-watermark Social rows; capture complete rollback evidence';
  end if;
  if exists (
    select 1 from _social_reconciled r
    left join public.social_threads t on t.id::text = r.entry->>'id'
    left join _social_restore_rows b on b.id::text = r.entry->>'id'
    where t.id is null or b.id is not null or t.created_at <= watermark
      or t.district_id <> r.entry->>'tenant'
      or to_jsonb(t) <> r.entry->'row'
      or encode(digest(convert_to(to_jsonb(t)::text, 'UTF8'), 'sha256'), 'hex') <> r.entry->>'currentChecksumSha256'
      or coalesce((select jsonb_agg(e.id::text order by e.id) from public.social_review_events e where e.social_thread_id=t.id), '[]'::jsonb) <> r.entry->'auditEventIds'
      or coalesce((select jsonb_agg(distinct e.batch_id::text order by e.batch_id::text) from public.social_review_events e where e.social_thread_id=t.id), '[]'::jsonb) <> r.entry->'auditBatchIds'
  ) then
    raise exception 'Rollback evidence contains an invalid or changed post-watermark row/audit linkage';
  end if;
  if (select count(*) from public.social_review_batches) <> (select (doc->'evidence'->'manifest'->'audit'->>'batchCount')::bigint from _social_restore_payload)
     or (select count(*) from public.social_review_events) <> (select (doc->'evidence'->'manifest'->'audit'->>'eventCount')::bigint from _social_restore_payload)
     or (select encode(digest(convert_to(coalesce(string_agg(e.id::text||':'||e.batch_id::text||':'||e.social_thread_id::text,E'\n' order by e.id),''),'UTF8'),'sha256'),'hex') from public.social_review_events e)
        <> (select doc->'evidence'->'manifest'->'audit'->>'linkageChecksumSha256' from _social_restore_payload) then
    raise exception 'Immutable Social audit rows/linkage differ from rollback evidence';
  end if;
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.social_threads'::regclass and not tgisinternal
      and (tgname <> 'social_threads_touch_updated_at' or tgenabled <> 'O')
  ) then
    raise exception 'Unexpected or disabled social_threads trigger blocks exact restoration';
  end if;
end
$guard$;

do $trigger$
begin
  alter table public.social_threads disable trigger social_threads_touch_updated_at;
end
$trigger$;

do $inverse$
declare item jsonb;
begin
  for item in select entry from _social_reconciled where entry->>'disposition'='replay' order by entry->>'id' loop
    perform pg_temp.canary_replay_social_thread_n1(item);
  end loop;
  for item in select entry from _social_reconciled where entry->>'disposition'='delete_qa_fixture' order by entry->>'id' loop
    if item->>'fixtureMarker' !~ '^controlled-qa:[A-Za-z0-9._:-]{1,100}$'
       or item->'row'->'provider_metadata'->>'rollback_fixture_marker' <> item->>'fixtureMarker'
       or item->>'tenant' <> item->'row'->>'district_id'
       or jsonb_array_length(item->'auditEventIds') <> 0 then
      raise exception 'QA fixture manifest marker, tenant, checksum, or audit guard failed';
    end if;
    delete from public.social_threads t
    where t.id::text=item->>'id' and t.district_id=item->>'tenant'
      and to_jsonb(t)=item->'row'
      and encode(digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex')=item->>'currentChecksumSha256';
    if not found then raise exception 'QA fixture delete did not match exactly'; end if;
  end loop;
end
$inverse$;

update public.social_threads t
set relationship_type = b.relationship_type,
    visibility_status = b.visibility_status,
    review_version = b.review_version,
    reviewed_at = b.reviewed_at::timestamptz,
    reviewed_by = b.reviewed_by,
    updated_at = b.updated_at::timestamptz
from _social_restore_rows b
where t.id = b.id;

alter table public.social_threads enable trigger social_threads_touch_updated_at;

do $verify$
begin
  if exists (
    select 1 from _social_restore_rows b
    join public.social_threads t on t.id = b.id
    where pg_temp.social_row_checksum(t) <> b.canonical_checksum_sha256
  ) then
    raise exception 'Exact Social row restoration checksum failed';
  end if;
  if (select count(*) from _social_replay_results) <> (select count(*) from _social_reconciled where entry->>'disposition'='replay')
     or exists (
       select 1 from _social_reconciled r join public.social_threads t on t.id::text=r.entry->>'id'
       where r.entry->>'disposition'='replay'
         and t.visibility_status <> case when r.entry->'row'->>'visibility_status'='active' then 'review' else 'excluded' end
     ) then
    raise exception 'N-1 post-watermark replay verification failed';
  end if;
  if (select count(*) from public.social_review_batches) <> (select (doc->'evidence'->'manifest'->'audit'->>'batchCount')::bigint from _social_restore_payload)
     or (select count(*) from public.social_review_events) <> (select (doc->'evidence'->'manifest'->'audit'->>'eventCount')::bigint from _social_restore_payload) then
    raise exception 'Social audit history changed during restoration';
  end if;
end
$verify$;
commit;`;

if (get('sql-output')) {
  await writeFile(get('sql-output'), `${sql}\n`, { mode: 0o600, flag: 'wx' });
  console.log(`Verified backup and wrote fail-closed restore SQL: ${get('sql-output')}`);
} else if (has('execute')) {
  const databaseUrl = get('database-url') || process.env.DATABASE_URL;
  assert.ok(databaseUrl, '--execute requires DATABASE_URL or --database-url');
  const result = spawnSync(process.env.PSQL_BIN || 'psql', ['-X','-q','-v','ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
    env: psqlEnvironment(databaseUrl),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr.trim() || 'restore failed');
  console.log(`Restored and checksum-verified ${artifact.rows.length} pre-watermark rows; replayed ${evidence.manifest.replayRowCount} real post-watermark rows and removed ${evidence.manifest.qaFixtureDeleteCount} manifest-verified QA fixtures.`);
} else {
  throw new Error('Choose --sql-output for manual SQL Editor handoff or --execute for an approved database URL');
}
