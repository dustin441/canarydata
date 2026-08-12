import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withSocialDatabase } from './fixtures/social-db-harness.mjs';

const ADMIN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLIENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const uuidFrom = (output) => {
  const match = String(output).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.ok(match, `Expected UUID in psql output: ${output}`);
  return match[0];
};
const candidatePayload = JSON.stringify({
  district_id: 'district-a', provider: 'apify', platform: 'facebook', external_thread_id: 'candidate-1',
  canonical_url: 'https://facebook.test/candidate-1', relationship_type: 'ambient', author_name: 'Public author',
  headline: 'Candidate headline', body: 'Candidate body', published_at: '2026-08-12T12:00:00Z',
  provider_metadata: { review_only: true }, source_workflow_id: 'workflow-1', source_execution_id: 'execution-1',
}).replaceAll("'", "''");

await withSocialDatabase('discovery-gate', async ({ sql, sqlAsync, expectFailure }) => {
  const [gateMigration, gateRollback] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260812162000_social_discovery_candidate_gate.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/rollbacks/20260812162000_social_discovery_candidate_gate_down.sql', import.meta.url), 'utf8'),
  ]);
  // The shared harness installs Task 4. Move only its disposable rows/constraint to the proven
  // Task 5 active/excluded shape; the guarded Task 5 migration has its own captured-contract suite.
  sql(`
    update public.social_threads set visibility_status='active' where visibility_status in ('review','approved');
    alter table public.social_threads alter column visibility_status set default 'active';
    alter table public.social_threads drop constraint social_threads_visibility_status_check;
    alter table public.social_threads add constraint social_threads_visibility_status_check check (visibility_status in ('active','excluded'));
    drop function if exists public.canary_review_social_thread(uuid,uuid,text,integer,text,text);
    drop function if exists public.canary_bulk_review_social_threads(uuid,text,uuid[],text);
  `);
  sql(gateMigration);

  const stage = () => uuidFrom(sql(`select (public.canary_stage_social_discovery('${candidatePayload}'::jsonb)).id;`, { role: 'service_role' }));
  const candidateId = stage();
  assert.match(candidateId, /^[0-9a-f-]{36}$/);
  assert.equal(stage(), candidateId, 'rediscovery must reuse the exact candidate identity');
  assert.match(sql(`select status || '|' || review_version from public.social_discovery_candidates where id='${candidateId}';`), /\bpending\|1\b/);
  assert.match(sql(`select count(*) from public.social_threads where external_thread_id='candidate-1';`), /\n\s*0\s*\n/);

  expectFailure(`select public.canary_stage_social_discovery('${candidatePayload.replace('apify', 'other-provider')}'::jsonb);`, /provider lineage is immutable/i, { role: 'service_role' });
  for (const role of ['anon', 'authenticated']) {
    expectFailure(`select public.canary_stage_social_discovery('${candidatePayload}'::jsonb);`, /permission denied/i, { role });
  }

  const review = (actor, action, version, key, note = 'Reviewed evidence') => `select (public.canary_review_social_discovery('${actor}','district-a','${candidateId}','${action}',${version},'${note}','${key}')).*;`;
  expectFailure(review(CLIENT, 'approve', 1, 'candidate-client-1'), /reviewer access is required/i, { role: 'service_role' });
  expectFailure(`select public.canary_review_social_discovery('${ADMIN}','district-b','${candidateId}','approve',1,'note','candidate-wrong-district');`, /district does not match/i, { role: 'service_role' });
  expectFailure(review(ADMIN, 'approve', 0, 'candidate-stale-01'), /changed; refresh/i, { role: 'service_role' });

  const approveSql = review(ADMIN, 'approve', 1, 'candidate-approve-1');
  const [first, replay] = await Promise.all([sqlAsync(`set role service_role; ${approveSql}`), sqlAsync(`set role service_role; ${approveSql}`)]);
  assert.equal(replay, first, 'concurrent replay must return the same immutable completed result');
  sql(`do $$ begin
    if (select status from public.social_discovery_candidates where id='${candidateId}') <> 'approved' then raise exception 'candidate not approved'; end if;
    if (select count(*) from public.social_threads where district_id='district-a' and platform='facebook' and external_thread_id='candidate-1' and visibility_status='active') <> 1 then raise exception 'promotion missing'; end if;
    if (select count(*) from public.social_discovery_review_events where candidate_id='${candidateId}' and action='approve') <> 1 then raise exception 'approval audited incorrectly'; end if;
  end $$;`);
  expectFailure(review(ADMIN, 'reject', 1, 'candidate-after-approval'), /Only pending/i, { role: 'service_role' });
  stage();
  assert.match(sql(`select status || '|' || review_version from public.social_discovery_candidates where id='${candidateId}';`), /\bapproved\|2\b/, 'rediscovery must not reopen an approved decision');
  const changedTerminalPayload = candidatePayload.replace('Candidate headline', 'Changed after approval');
  sql(`select public.canary_stage_social_discovery('${changedTerminalPayload}'::jsonb);`, { role: 'service_role' });
  assert.match(sql(`select candidate_payload->>'headline' from public.social_discovery_candidates where id='${candidateId}';`), /Candidate headline/, 'rediscovery must preserve the exact reviewed terminal payload');

  const rejectPayload = candidatePayload.replaceAll('candidate-1', 'candidate-2');
  const rejectId = uuidFrom(sql(`select (public.canary_stage_social_discovery('${rejectPayload}'::jsonb)).id;`, { role: 'service_role' }));
  sql(`select public.canary_review_social_discovery('${ADMIN}','district-a','${rejectId}','reject',0,'Not relevant','candidate-reject-1');`, { role: 'service_role' });
  assert.match(sql(`select status || '|' || (promoted_social_thread_id is null)::text from public.social_discovery_candidates where id='${rejectId}';`), /\brejected\|true\b/);
  assert.match(sql(`select count(*) from public.social_threads where external_thread_id='candidate-2';`), /\n\s*0\s*\n/);
  const excludedPayload = candidatePayload.replaceAll('candidate-1', 'candidate-excluded');
  const excludedId = uuidFrom(sql(`select (public.canary_stage_social_discovery('${excludedPayload}'::jsonb)).id;`, { role: 'service_role' }));
  sql(`insert into public.social_threads(district_id,provider,platform,external_thread_id,canonical_url,relationship_type,body,published_at,visibility_status) values('district-a','apify','facebook','candidate-excluded','https://facebook.test/candidate-excluded','ambient','Previously excluded',now(),'excluded');`);
  expectFailure(`select public.canary_review_social_discovery('${ADMIN}','district-a','${excludedId}','approve',0,'Reviewed','candidate-excluded-approve');`, /separate audited restore action/i, { role: 'service_role' });
  assert.match(sql(`select status || '|' || review_version from public.social_discovery_candidates where id='${excludedId}';`), /\bpending\|0\b/);
  expectFailure('update public.social_discovery_review_events set action=action;', /immutable/i);
  expectFailure('delete from public.social_discovery_review_requests;', /immutable/i);
  expectFailure(gateRollback, /Refusing rollback while reviewed Social discovery history exists/i);

  for (const role of ['anon', 'authenticated']) {
    assert.match(sql(`select has_table_privilege('${role}','public.social_discovery_candidates','select,insert,update,delete');`), /\n\s*f\s*\n/);
  }
});

await withSocialDatabase('discovery-gate-rollback', async ({ sql }) => {
  const [gateMigration, gateRollback] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260812162000_social_discovery_candidate_gate.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/rollbacks/20260812162000_social_discovery_candidate_gate_down.sql', import.meta.url), 'utf8'),
  ]);
  sql(`update public.social_threads set visibility_status='active' where visibility_status in ('review','approved');alter table public.social_threads alter column visibility_status set default 'active';alter table public.social_threads drop constraint social_threads_visibility_status_check;alter table public.social_threads add constraint social_threads_visibility_status_check check (visibility_status in ('active','excluded'));drop function if exists public.canary_review_social_thread(uuid,uuid,text,integer,text,text);drop function if exists public.canary_bulk_review_social_threads(uuid,text,uuid[],text);`);
  sql(gateMigration);sql(gateRollback);
  assert.match(sql("select to_regclass('public.social_discovery_candidates') is null;"), /\n\s*t\s*\n/);
});

console.log('Social discovery candidate gate integration checks passed.');
