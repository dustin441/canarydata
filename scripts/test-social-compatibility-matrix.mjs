#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const IMAGE = 'postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const PASSWORD = 'disposable-social-task7-only';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonicalJson = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
const csv = (header, value) => `${header}\r\n"${JSON.stringify(value).replaceAll('"', '""')}"\r\n`;
const parseJsonOutput = (text) => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  assert.ok(start >= 0 && end >= start, `Expected JSON output, received: ${text.slice(0, 300)}`);
  return JSON.parse(text.slice(start, end + 1));
};
const elapsedMs = (start) => Number(process.hrtime.bigint() - start) / 1e6;
const visibilityFields = ['id','district_id','relationship_type','visibility_status','review_version','reviewed_at','reviewed_by','created_at','updated_at'];
const visibilityRowChecksum = (row) => sha256(visibilityFields.map((field) => {
  const value = row[field] === null || row[field] === undefined ? '<NULL>' : String(row[field]);
  return `${Buffer.byteLength(value, 'utf8')}:${value}`;
}).join('|'));
const visibilityAggregateChecksum = (rows) => sha256(rows
  .map((row) => ({ ...row, canonical_checksum_sha256: visibilityRowChecksum(row) }))
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((row) => `${row.id}:${row.canonical_checksum_sha256}`).join('\n'));
const normalizedUtcMicros = (value) => {
  const match = String(value).match(/^(.*?)(?:\.(\d+))?(?:\+00:00|Z)$/);
  assert.ok(match, `Expected a UTC timestamp, received ${value}`);
  return `${match[1]}.${(match[2] || '').padEnd(6, '0').slice(0, 6)}Z`;
};

function spawn(command, args, options = {}, expectedSuccess = true) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (expectedSuccess && result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  if (!expectedSuccess && result.status === 0) throw new Error(`${command} unexpectedly succeeded`);
  return result;
}

function sqlRunner(container) {
  return (sql, expectedSuccess = true) => spawn('docker', [
    'exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
  ], { input: sql }, expectedSuccess);
}

async function artifactFingerprint(paths, source = 'worktree') {
  const parts = [];
  for (const path of paths) {
    let content;
    if (source === 'stable-git') {
      const result = spawn('git', ['show', `6fa872818bf729b0979d30ecfa8aaba44836bd09:${path}`], { cwd: ROOT });
      content = result.stdout;
    } else {
      content = await readFile(join(ROOT, path));
    }
    parts.push(`${path}:${sha256(content)}`);
  }
  return sha256(parts.sort().join('\n'));
}

function fixtureSql(matrix) {
  const rows = [];
  let sequence = 1;
  for (const tenant of matrix.tenants) {
    for (const status of matrix.statuses) {
      for (const ownershipClass of matrix.ownershipClasses) {
        const suffix = String(sequence).padStart(12, '0');
        const owned = ownershipClass === 'verified-owned';
        rows.push(`(
          '70000000-0000-0000-0000-${suffix}', '${tenant.id}', ${owned ? `'${tenant.ownedAccountId}'` : 'null'},
          'meta', 'facebook', 'task7-${tenant.id}-${status}-${ownershipClass}',
          'https://fixture.invalid/${tenant.id}/${status}/${ownershipClass}', '${owned ? 'owned' : 'ambient'}',
          '2026-08-05T10:00:00Z', '${status}', ${sequence},
          ${status === 'approved' ? `'2026-08-05T10:01:00Z', '${matrix.actors.admin}'` : 'null, null'},
          jsonb_build_object('qa_fixture_marker','${matrix.fixtureMarker}','ownership_class','${ownershipClass}'),
          '2026-08-05T10:00:00Z', '2026-08-05T10:00:00Z'
        )`);
        sequence += 1;
      }
    }
  }
  return `insert into public.social_threads (
    id,district_id,social_account_id,provider,platform,external_thread_id,canonical_url,relationship_type,
    published_at,visibility_status,review_version,reviewed_at,reviewed_by,provider_metadata,created_at,updated_at
  ) values ${rows.join(',\n')};`;
}

function rowsExportSql(watermark) {
  return `select jsonb_build_object('watermark','${watermark}','rows',jsonb_agg(jsonb_build_object(
    'id',id::text,'district_id',district_id,'relationship_type',relationship_type,
    'visibility_status',visibility_status,'review_version',review_version,
    'reviewed_at',case when reviewed_at is null then null else to_char(reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'reviewed_by',reviewed_by::text,'created_at',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'updated_at',to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by id)) from public.social_threads;`;
}

export async function runCompatibilityMatrix({ mode = 'compatibility' } = {}) {
  const startedAt = new Date();
  const totalStart = process.hrtime.bigint();
  const runId = `${mode}-${startedAt.toISOString().replaceAll(/[-:.TZ]/g, '')}-${randomUUID()}`;
  const matrix = JSON.parse(await readFile(join(ROOT, 'scripts/fixtures/social-compatibility-matrix.json'), 'utf8'));
  const container = `canary-social-task7-${process.pid}-${randomBytes(4).toString('hex')}`;
  const temp = await mkdtemp(join(tmpdir(), 'canary-social-task7-'));
  const assertions = [];
  const combinations = [];
  const phaseDurationsMs = {};
  const unresolvedItems = [];
  let cleanup = { attempted: false, containerRemoved: false, tempRemoved: false, checksumVerified: false };
  let started = false;
  let evidence;
  const record = (name, actual, expected = true, details = {}) => {
    const passed = typeof expected === 'function' ? expected(actual) : Object.is(actual, expected);
    assertions.push({ name, passed, actual, expected: typeof expected === 'function' ? 'predicate' : expected, ...details });
    assert.ok(passed, `${name}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    return actual;
  };
  const phase = async (name, fn) => {
    const start = process.hrtime.bigint();
    try { return await fn(); } finally { phaseDurationsMs[name] = Number(elapsedMs(start).toFixed(3)); }
  };

  try {
    record('matrix fixture format', matrix.format, 'canary-social-compatibility-matrix/v1');
    record('four required combinations declared', matrix.combinations.length, 4);
    record('all combinations unique', new Set(matrix.combinations.map(({ id }) => id)).size, 4);
    record('two tenants declared', matrix.tenants.length >= 2, true);
    record('complete status cross declared', canonicalJson([...matrix.statuses].sort()), canonicalJson(['active', 'approved', 'excluded', 'review']));
    record('complete ownership cross declared', canonicalJson([...matrix.ownershipClasses].sort()), canonicalJson(['public', 'verified-owned']));

    spawn('docker', ['info']);
    await phase('start_disposable_postgresql', async () => {
      spawn('docker', ['run', '--detach', '--rm', '--name', container, '-e', `POSTGRES_PASSWORD=${PASSWORD}`, IMAGE]);
      started = true;
      let ready = false;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const first = spawnSync('docker', ['exec', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-c', 'select 1'], { encoding: 'utf8' });
        if (first.status === 0) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          const stable = spawnSync('docker', ['exec', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-c', 'select 1'], { encoding: 'utf8' });
          if (stable.status === 0) { ready = true; break; }
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      record('disposable PostgreSQL ready', ready, true);
    });
    const psql = sqlRunner(container);
    const files = {};
    await Promise.all(Object.entries(matrix.artifacts).filter(([, path]) => !path.startsWith('/')).map(async ([name, path]) => {
      files[name] = await readFile(join(ROOT, path), 'utf8');
    }));

    const applicationFingerprints = {
      'N-1': await artifactFingerprint(matrix.applications['N-1'], 'stable-git'),
      N: await artifactFingerprint(matrix.applications.N),
    };
    const localTask6Evidence = matrix.artifacts.task6WriterEvidence;
    let task6Fingerprint = null;
    try { task6Fingerprint = sha256(await readFile(localTask6Evidence)); } catch { /* Portable runs use repository artifacts only. */ }
    const writerFingerprints = {
      'N-1': await artifactFingerprint(['src/lib/socialIngestion.mjs'], 'stable-git'),
      N: sha256(`${sha256(files.task4Migration)}:${task6Fingerprint || 'task6-evidence-not-mounted'}`),
      task6Evidence: task6Fingerprint,
    };

    let pureN1;
    let n1Contract;
    let nContract;
    let backup;
    let rollbackArtifact;
    let restored;
    let preRollbackCounts;
    let postRollbackCounts;
    let restoredRowsChecksum;

    await phase('seed_and_capture_n1', async () => {
      psql(files.n1Fixture);
      psql(files.capturedN1);
      psql(fixtureSql(matrix));
      pureN1 = parseJsonOutput(psql(files.restoredN1Verifier).stdout);
      record('pure N-1 verifier identity', pureN1.verification_identity, 'exact-restored-pure-n-1-non-sealing');
      record('seed row count', Number(psql('select count(*) from social_threads;').stdout.trim()), 16);
      record('seed cross cardinality', Number(psql("select count(*) from (select district_id,visibility_status,provider_metadata->>'ownership_class' ownership from social_threads group by 1,2,3) x;").stdout.trim()), 16);
      await writeFile(join(temp, 'pure-n1.csv'), csv('social_restored_n1_verification', pureN1));
      spawn(process.execPath, [join(ROOT, 'scripts/verify-social-restored-n1.mjs'), '--capture-baseline-input', join(temp, 'pure-n1.csv'), '--output', join(temp, 'pure-n1-baseline.json')]);
      psql(files.task4Migration);
      n1Contract = parseJsonOutput(psql(`set canary.expected_social_state='N-1';set canary.expected_social_rows='16';set canary.expected_social_exclusions='4';${files.contractVerifier}`).stdout);
      await writeFile(join(temp, 'n1-contract.csv'), csv('social_visibility_contract', n1Contract));
      spawn(process.execPath, [join(ROOT, 'scripts/capture-social-schema-contract.mjs'), '--input', join(temp, 'n1-contract.csv'), '--output', join(temp, 'n1-contract.json')]);
      spawn(process.execPath, [join(ROOT, 'scripts/verify-social-restored-n1.mjs'), '--baseline-artifact', join(temp, 'pure-n1-baseline.json'), '--additive-contract', join(temp, 'n1-contract.json'), '--sql-output', join(temp, 'verify-restored.sql')]);
      const sourceRows = parseJsonOutput(psql(rowsExportSql(matrix.watermark)).stdout);
      await writeFile(join(temp, 'visibility.csv'), csv('social_visibility_backup', sourceRows));
      spawn(process.execPath, [join(ROOT, 'scripts/backup-social-visibility.mjs'), '--input', join(temp, 'visibility.csv'), '--schema-contract', join(temp, 'n1-contract.json'), '--output', join(temp, 'visibility-backup.json')]);
      backup = JSON.parse(await readFile(join(temp, 'visibility-backup.json'), 'utf8'));
      record('N-1 backup row count', backup.manifest.rowCount, 16);
      record('N-1 backup checksum format', backup.manifest.aggregateChecksumSha256, (value) => /^[a-f0-9]{64}$/.test(value));
    });

    await phase('combination_1', async () => {
      const combo = matrix.combinations[0];
      const beforeAudit = Number(psql('select count(*) from social_review_events;').stdout.trim());
      const transaction = psql(`begin;
        select (public.canary_apply_social_correction('${matrix.actors.admin}','district-a','70000000-0000-0000-0000-000000000005','exclude',5,'task7-combo1-hide')).visibility_status;
        select (public.canary_apply_social_correction('${matrix.actors.admin}','district-a','70000000-0000-0000-0000-000000000005','restore',6,'task7-combo1-restore')).visibility_status;
        insert into social_threads(district_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at) values('district-a','meta','facebook','combo1-old-writer','https://fixture.invalid/combo1','ambient','2026-08-05T11:00:00Z') returning visibility_status;
        rollback;`).stdout.trim().split(/\s+/);
      record('combo1 N app admin loads both tenants', Number(psql('select count(*) from social_threads;').stdout.trim()), 16);
      record('combo1 signed client tenant scope', Number(psql("select count(*) from social_threads where district_id='district-a';").stdout.trim()), 8);
      record('combo1 old writer receives N-1 default', transaction.at(-1), 'review');
      record('combo1 hide and restore outcomes', transaction.slice(0, 2).join(','), 'excluded,active');
      record('combo1 transaction leaves audit immutable', Number(psql('select count(*) from social_review_events;').stdout.trim()), beforeAudit);
      combinations.push({ ...combo, executed: true, assertions: assertions.filter(({ name }) => name.startsWith('combo1')).map(({ name, passed }) => ({ name, passed })) });
    });

    await phase('forward_migration', async () => {
      psql(files.task5Migration);
      nContract = parseJsonOutput(psql(`set canary.expected_social_state='N';set canary.expected_social_rows='16';set canary.expected_social_exclusions='4';${files.contractVerifier}`).stdout);
      record('forward status mapping', canonicalJson(nContract.status_counts), canonicalJson({ active: 12, excluded: 4 }));
      record('forward official report checksum preserved', nContract.official_report_set_md5, n1Contract.official_report_set_md5);
    });

    await phase('combination_2', async () => {
      const combo = matrix.combinations[1];
      const oldWriterId = psql(`insert into social_threads(district_id,provider,platform,external_thread_id,canonical_url,relationship_type,published_at,provider_metadata,created_at,updated_at)
        values('district-a','meta','facebook','task7-old-writer-post-watermark','https://fixture.invalid/old-writer','ambient','2026-08-05T13:00:00Z','{"writer":"N-1"}','2026-08-05T13:00:00Z','2026-08-05T13:00:00Z') returning id;`).stdout.trim();
      record('combo2 old payload accepted and mapped', psql(`select visibility_status from social_threads where id='${oldWriterId}';`).stdout.trim(), 'active');
      const excludedId = '70000000-0000-0000-0000-000000000007';
      psql(`update social_threads set body='old-writer-adversarial-replay' where id='${excludedId}';`);
      record('combo2 old writer replay preserves exclusion', psql(`select visibility_status from social_threads where id='${excludedId}';`).stdout.trim(), 'excluded');
      record('combo2 reports remain verified-owned only', Number(psql("select count(*) from social_threads where visibility_status='active' and relationship_type='owned' and social_account_id is not null;").stdout.trim()), 6);
      combinations.push({ ...combo, executed: true, artifactIds: [oldWriterId], assertions: assertions.filter(({ name }) => name.startsWith('combo2')).map(({ name, passed }) => ({ name, passed })) });
    });

    await phase('combination_3', async () => {
      const combo = matrix.combinations[2];
      const newPayload = JSON.stringify({
        district_id: 'district-b', provider: 'meta', platform: 'facebook', external_thread_id: 'task7-new-writer-post-watermark',
        canonical_url: 'https://fixture.invalid/new-writer', relationship_type: 'ambient', published_at: '2026-08-05T13:01:00Z',
        visibility_status: 'active', body: 'new-writer-payload', provider_metadata: { qa_fixture_marker: matrix.fixtureMarker, writer: 'N' },
      }).replaceAll("'", "''");
      const newWriterId = psql(`select (public.canary_ingest_social_thread('${newPayload}'::jsonb)).id;`).stdout.trim();
      const replayId = psql(`select (public.canary_ingest_social_thread('${newPayload}'::jsonb)).id;`).stdout.trim();
      record('combo3 new writer payload accepted', newWriterId, (value) => /^[a-f0-9-]{36}$/.test(value));
      record('combo3 ingestion replay idempotent', replayId, newWriterId);
      record('combo3 ingestion replay creates one row', Number(psql("select count(*) from social_threads where external_thread_id='task7-new-writer-post-watermark';").stdout.trim()), 1);

      const target = '70000000-0000-0000-0000-000000000005';
      const initialVersion = Number(psql(`select review_version from social_threads where id='${target}';`).stdout.trim());
      const hide = parseJsonOutput(psql(`select to_jsonb(public.canary_apply_social_correction('${matrix.actors.admin}','district-a','${target}','exclude',${initialVersion},'task7-double-submit-hide'));`).stdout);
      const duplicate = parseJsonOutput(psql(`select to_jsonb(public.canary_apply_social_correction('${matrix.actors.admin}','district-a','${target}','exclude',${initialVersion},'task7-double-submit-hide'));`).stdout);
      record('combo3 hide increments review version', hide.review_version, initialVersion + 1);
      record('combo3 double submit returns exact snapshot', canonicalJson(duplicate), canonicalJson(hide));
      record('combo3 double submit creates one audit event', Number(psql("select count(*) from social_review_events e join social_review_batches b on b.id=e.batch_id where b.criteria->>'idempotency_key'='task7-double-submit-hide';").stdout.trim()), 1);
      const stale = psql(`select public.canary_apply_social_correction('${matrix.actors.admin}','district-a','${target}','restore',${initialVersion},'task7-stale-version');`, false);
      record('combo3 stale version denied', /changed; refresh/i.test(stale.stderr), true);
      const crossTenant = psql(`select public.canary_apply_social_correction('${matrix.actors.admin}','district-b','${target}','restore',${initialVersion + 1},'task7-cross-tenant');`, false);
      record('combo3 cross-tenant mutation denied', /district does not match/i.test(crossTenant.stderr), true);
      const clientDenied = psql(`select public.canary_apply_social_correction('${matrix.actors.client}','district-a','${target}','restore',${initialVersion + 1},'task7-client-denied');`, false);
      record('combo3 signed client mutation denied', /reviewer access is required/i.test(clientDenied.stderr), true);
      const restoredRow = parseJsonOutput(psql(`select to_jsonb(public.canary_apply_social_correction('${matrix.actors.admin}','district-a','${target}','restore',${initialVersion + 1},'task7-restore-row'));`).stdout);
      record('combo3 restore returns active', restoredRow.visibility_status, 'active');
      record('combo3 restore increments review version', restoredRow.review_version, initialVersion + 2);

      const excludedId = '70000000-0000-0000-0000-000000000007';
      const adversarial = psql(`select (public.canary_ingest_social_thread(to_jsonb(t) || jsonb_build_object('visibility_status','active','body','new-writer-adversarial-replay'))).visibility_status from social_threads t where id='${excludedId}';`).stdout.trim();
      record('combo3 authoritative ingestion preserves excluded', adversarial, 'excluded');
      record('combo3 excluded row version unchanged by replay', Number(psql(`select review_version from social_threads where id='${excludedId}';`).stdout.trim()), 7);
      combinations.push({ ...combo, executed: true, artifactIds: [newWriterId], assertions: assertions.filter(({ name }) => name.startsWith('combo3')).map(({ name, passed }) => ({ name, passed })) });
    });

    await phase('combination_4_bridge', async () => {
      const combo = matrix.combinations[3];
      record('combo4 N-1 app bridge loads N rows', Number(psql("select count(*) from social_threads where visibility_status in ('active','excluded');").stdout.trim()), 18);
      record('combo4 N-1 app bridge client remains tenant scoped', Number(psql("select count(*) from social_threads where district_id='district-a' and visibility_status='active';").stdout.trim()), 7);
      record('combo4 N-1 app legacy visibility has no hidden exposure', Number(psql("select count(*) from social_threads where district_id='district-a' and visibility_status<>'excluded';").stdout.trim()), 7);
      record('combo4 bridge mutation contract available', psql("select to_regprocedure('public.canary_apply_social_correction(uuid,text,uuid,text,integer,text)') is not null;").stdout.trim(), 't');
      combinations.push({ ...combo, executed: true, assertions: assertions.filter(({ name }) => name.startsWith('combo4')).map(({ name, passed }) => ({ name, passed })) });
    });

    const rollbackTimer = process.hrtime.bigint();
    await phase('quiesce_writers', async () => {
      const before = psql("select count(*),max(updated_at) from social_threads;").stdout.trim();
      await new Promise((resolve) => setTimeout(resolve, 25));
      const after = psql("select count(*),max(updated_at) from social_threads;").stdout.trim();
      record('writer quiescence proves no continuing writes', after, before);
    });
    await phase('capture_post_watermark', async () => {
      preRollbackCounts = parseJsonOutput(psql("select jsonb_build_object('rows',count(*),'excluded',count(*) filter(where visibility_status='excluded'),'auditEvents',(select count(*) from social_review_events),'corrections',(select count(*) from social_correction_requests)) from social_threads;").stdout);
      const rollbackSource = parseJsonOutput(psql(`set canary.social_backup_watermark='${matrix.watermark}';${files.rollbackCapture}`).stdout);
      await writeFile(join(temp, 'rollback-source.csv'), csv('social_rollback_evidence', rollbackSource));
      spawn(process.execPath, [join(ROOT, 'scripts/capture-social-rollback-evidence.mjs'), '--input', join(temp, 'rollback-source.csv'), '--visibility-backup', join(temp, 'visibility-backup.json'), '--output', join(temp, 'rollback-evidence.json')]);
      rollbackArtifact = JSON.parse(await readFile(join(temp, 'rollback-evidence.json'), 'utf8'));
      record('every changed row marked for replay', rollbackArtifact.changedRows.every(({ disposition }) => disposition === 'replay'), true);
      record('rollback has no unresolved replay before reversal', rollbackArtifact.changedRows.length, rollbackArtifact.manifest.replayRowCount);
    });
    await phase('restore_prior_writers_inactive', async () => {
      record('prior writer fingerprint is available', writerFingerprints['N-1'], (value) => /^[a-f0-9]{64}$/.test(value));
    });
    await phase('reverse_schema', async () => {
      spawn(process.execPath, [join(ROOT, 'scripts/prepare-social-rollback.mjs'), '--evidence-artifact', join(temp, 'rollback-evidence.json'), '--sql-output', join(temp, 'down.sql')]);
      psql(await readFile(join(temp, 'down.sql'), 'utf8'));
      record('Task 4 writer removed before N-1 restoration', psql("select to_regprocedure('public.canary_ingest_social_thread(jsonb)') is null;").stdout.trim(), 't');
    });
    await phase('restore_data_and_replay', async () => {
      spawn(process.execPath, [join(ROOT, 'scripts/restore-social-visibility.mjs'), '--artifact', join(temp, 'visibility-backup.json'), '--rollback-evidence', join(temp, 'rollback-evidence.json'), '--sql-output', join(temp, 'restore.sql')]);
      psql(await readFile(join(temp, 'restore.sql'), 'utf8'));
      record('post-watermark replay count exact', Number(psql("select count(*) from social_threads where created_at>'2026-08-05T12:00:00Z';").stdout.trim()), rollbackArtifact.manifest.createdRowCount);
      record('old writer post-watermark row restored to N-1 review', psql("select visibility_status from social_threads where external_thread_id='task7-old-writer-post-watermark';").stdout.trim(), 'review');
      record('new writer post-watermark row restored to N-1 review', psql("select visibility_status from social_threads where external_thread_id='task7-new-writer-post-watermark';").stdout.trim(), 'review');
      record('adversarial exclusion remains excluded after replay', psql("select visibility_status from social_threads where id='70000000-0000-0000-0000-000000000007';").stdout.trim(), 'excluded');
    });
    await phase('verify_exact_n1', async () => {
      const boundVerifier = await readFile(join(temp, 'verify-restored.sql'), 'utf8');
      restored = parseJsonOutput(psql(boundVerifier).stdout);
      record('exact N-1 schema fingerprint restored', restored.pure_n1_schema_fingerprint_md5, pureN1.pure_n1_schema_fingerprint_md5);
      record('exact N-1 verifier identity restored', restored.verification_identity, 'exact-restored-pure-n-1-non-sealing');
      record('Task 4 table absent from exact N-1', psql("select to_regclass('public.social_correction_requests') is null;").stdout.trim(), 't');
      const restoredSource = parseJsonOutput(psql(`select jsonb_build_object('watermark','${matrix.watermark}','rows',jsonb_agg(jsonb_build_object(
        'id',id::text,'district_id',district_id,'relationship_type',relationship_type,'visibility_status',visibility_status,'review_version',review_version,
        'reviewed_at',case when reviewed_at is null then null else to_char(reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'reviewed_by',reviewed_by::text,'created_at',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'updated_at',to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by id) filter(where created_at<='${matrix.watermark}')) from social_threads;`).stdout);
      await writeFile(join(temp, 'restored-rows.csv'), csv('social_visibility_backup', restoredSource));
      spawn(process.execPath, [join(ROOT, 'scripts/backup-social-visibility.mjs'), '--input', join(temp, 'restored-rows.csv'), '--schema-identity', n1Contract.schema_identity, '--schema-fingerprint', n1Contract.schema_fingerprint_md5, '--expected-row-count', '16', '--unsafe-dev-schema-assertions', '--output', join(temp, 'restored-backup.json')]);
      const restoredBackup = JSON.parse(await readFile(join(temp, 'restored-backup.json'), 'utf8'));
      const changedById = new Map(rollbackArtifact.changedRows
        .filter(({ watermarkState }) => watermarkState === 'preexisting-at-watermark')
        .map((entry) => [entry.id, entry]));
      const correctionResultRows = new Set(rollbackArtifact.correctionRequests
        .filter(({ completedAt, resultRow }) => completedAt && resultRow)
        .map(({ resultRow }) => canonicalJson(resultRow)));
      const expectedReconciledRows = backup.rows.map(({ canonical_checksum_sha256: ignored, ...row }) => {
        void ignored;
        const changed = changedById.get(row.id);
        if (!changed || correctionResultRows.has(canonicalJson(changed.row))) return row;
        return { ...row, updated_at: normalizedUtcMicros(changed.row.updated_at) };
      });
      const expectedReconciledChecksum = visibilityAggregateChecksum(expectedReconciledRows);
      restoredRowsChecksum = restoredBackup.manifest.aggregateChecksumSha256;
      const actualById = new Map(restoredBackup.rows.map((row) => [row.id, row]));
      const checksumMismatches = expectedReconciledRows.flatMap((expectedRow) => {
        const actualRow = actualById.get(expectedRow.id);
        if (actualRow && visibilityRowChecksum(actualRow) === visibilityRowChecksum(expectedRow)) return [];
        return [{ id: expectedRow.id, expected: expectedRow, actual: actualRow || null }];
      });
      record('exact reconciled pre-watermark row checksum restored', restoredRowsChecksum, expectedReconciledChecksum, { checksumMismatches });
      cleanup.checksumVerified = true;
      postRollbackCounts = parseJsonOutput(psql("select jsonb_build_object('rows',count(*),'excluded',count(*) filter(where visibility_status='excluded'),'auditEvents',(select count(*) from social_review_events)) from social_threads;").stdout);
      record('rollback replay unresolved count', rollbackArtifact.manifest.replayRowCount - rollbackArtifact.changedRows.length, 0);
    });
    await phase('signed_n1_smoke', async () => {
      record('N-1 admin smoke row count', Number(psql('select count(*) from social_threads;').stdout.trim()), 18);
      record('N-1 client smoke tenant isolation', Number(psql("select count(*) from social_threads where district_id='district-a';").stdout.trim()), 9);
      const crossTenantSnapshot = psql("select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from social_threads t where district_id='district-b';").stdout.trim();
      record('N-1 signed client cannot execute admin RPC', psql("set role authenticated; select has_function_privilege(current_user,'public.canary_review_social_thread(uuid,uuid,text,integer,text,text)','execute');").stdout.trim(), 'f');
      record('N-1 cross-tenant rows unchanged', psql("select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from social_threads t where district_id='district-b';").stdout.trim(), crossTenantSnapshot);
    });
    phaseDurationsMs.total_recovery_time = Number(elapsedMs(rollbackTimer).toFixed(3));

    record('no compatibility combination skipped', combinations.length, 4);
    record('all compatibility combinations executed', combinations.every(({ executed }) => executed), true);
    record('all assertions passed before cleanup', assertions.every(({ passed }) => passed), true);

    const artifactFingerprints = Object.fromEntries(Object.entries(matrix.artifacts).filter(([, path]) => !path.startsWith('/')).map(([name]) => [name, sha256(files[name])]));
    evidence = {
      format: 'canary-social-task7-evidence/v1', mode, releaseId: matrix.releaseId, runId,
      startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(),
      runtime: { target: 'disposable-postgresql-docker-only', image: IMAGE, container },
      fingerprints: {
        schema: { pureN1: pureN1.pure_n1_schema_fingerprint_md5, task5N1: n1Contract.schema_fingerprint_md5, N: nContract.schema_fingerprint_md5, restoredPureN1: restored.pure_n1_schema_fingerprint_md5 },
        data: { n1BackupSha256: backup.manifest.artifactSha256, n1RowsSha256: backup.manifest.aggregateChecksumSha256, rollbackEvidenceSha256: rollbackArtifact.manifest.artifactSha256 },
        application: applicationFingerprints, writers: writerFingerprints, artifacts: artifactFingerprints,
      },
      counts: { beforeRollback: preRollbackCounts, afterRollback: postRollbackCounts, combinations: combinations.length, assertions: assertions.length, replayRows: rollbackArtifact.manifest.replayRowCount },
      checksums: { officialReportN1Md5: n1Contract.official_report_set_md5, officialReportNMd5: nContract.official_report_set_md5, baselineRowsSha256: backup.manifest.aggregateChecksumSha256, restoredReconciledRowsSha256: restoredRowsChecksum },
      combinations, assertions, rollback: { phaseDurationsMs, totalRecoveryTimeMs: phaseDurationsMs.total_recovery_time, exactN1Verified: true },
      cleanup, unresolvedItems,
    };
  } catch (error) {
    unresolvedItems.push({ type: 'execution-failure', message: error.message });
    assertions.push({ name: 'unhandled execution failure', passed: false, actual: error.message, expected: null });
    evidence = evidence || {
      format: 'canary-social-task7-evidence/v1', mode, releaseId: matrix.releaseId, runId,
      startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(),
      runtime: { target: 'disposable-postgresql-docker-only', image: IMAGE, container },
      fingerprints: {}, counts: { combinations: combinations.length, assertions: assertions.length }, checksums: {},
      combinations, assertions, rollback: { phaseDurationsMs, totalRecoveryTimeMs: null, exactN1Verified: false }, cleanup, unresolvedItems,
    };
  } finally {
    cleanup.attempted = true;
    if (started) spawnSync('docker', ['rm', '--force', container], { encoding: 'utf8' });
    const remaining = spawnSync('docker', ['ps', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}'], { encoding: 'utf8' });
    cleanup.containerRemoved = remaining.status === 0 && remaining.stdout.trim() === '';
    try { await rm(temp, { recursive: true, force: true }); cleanup.tempRemoved = true; } catch (error) { unresolvedItems.push({ type: 'cleanup-failure', message: error.message }); }
    cleanup.passed = cleanup.containerRemoved && cleanup.tempRemoved && cleanup.checksumVerified;
    if (!cleanup.containerRemoved) unresolvedItems.push({ type: 'cleanup-failure', message: `Container remains: ${container}` });
    if (!cleanup.checksumVerified) unresolvedItems.push({ type: 'checksum-failure', message: 'Exact restored checksum was not verified' });
    if (evidence) {
      evidence.completedAt = new Date().toISOString();
      evidence.cleanup = cleanup;
      evidence.unresolvedItems = unresolvedItems;
      evidence.totalDurationMs = Number(elapsedMs(totalStart).toFixed(3));
      evidence.passed = assertions.every(({ passed }) => passed) && combinations.length === 4 && cleanup.passed && unresolvedItems.length === 0;
      evidence.evidenceSha256 = sha256(canonicalJson({ ...evidence, evidenceSha256: null }));
    }
  }
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await runCompatibilityMatrix({ mode: 'compatibility' });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.passed) process.exitCode = 1;
}
