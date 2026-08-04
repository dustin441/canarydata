import assert from 'node:assert/strict';
import { withSocialDatabase } from './fixtures/social-db-harness.mjs';

const ADMIN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLIENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const THREAD_REVIEW = '30000000-0000-0000-0000-000000000001';
const THREAD_APPROVED = '30000000-0000-0000-0000-000000000002';
const THREAD_ACTIVE = '30000000-0000-0000-0000-000000000003';
const THREAD_DUP = '30000000-0000-0000-0000-000000000004';
const call = (actor, district, thread, action, version, key) =>
  `select (public.canary_apply_social_correction('${actor}', '${district}', '${thread}', '${action}', ${version}, '${key}')).*;`;

await withSocialDatabase('lifecycle', async ({ sql, sqlAsync, expectFailure }) => {
  sql(`
    insert into public.social_threads
      (id, district_id, social_account_id, provider, platform, external_thread_id, canonical_url,
       relationship_type, body, published_at, visibility_status, review_version)
    values
      ('${THREAD_REVIEW}', 'district-a', '11111111-1111-1111-1111-111111111111', 'meta', 'facebook', 'review-1', 'https://facebook.test/review-1', 'owned', 'review body', now(), 'review', 0),
      ('${THREAD_APPROVED}', 'district-a', '11111111-1111-1111-1111-111111111111', 'meta', 'facebook', 'approved-1', 'https://facebook.test/approved-1', 'owned', 'approved body', now(), 'approved', 3),
      ('${THREAD_ACTIVE}', 'district-a', '11111111-1111-1111-1111-111111111111', 'meta', 'facebook', 'active-1', 'https://facebook.test/active-1', 'owned', 'active body', now(), 'active', 7),
      ('${THREAD_DUP}', 'district-a', '11111111-1111-1111-1111-111111111111', 'meta', 'facebook', 'duplicate-1', 'https://facebook.test/duplicate-1', 'owned', 'duplicate body', now(), 'active', 0);
  `);

  sql(call(ADMIN, 'district-a', THREAD_REVIEW, 'exclude', 0, 'life-review-0001'));
  sql(call(ADMIN, 'district-a', THREAD_APPROVED, 'exclude', 3, 'life-approved-01'));
  sql(call(ADMIN, 'district-a', THREAD_ACTIVE, 'exclude', 7, 'life-active-0001'));
  sql(`do $$ begin
    if exists (select 1 from public.social_threads where id in ('${THREAD_REVIEW}','${THREAD_APPROVED}','${THREAD_ACTIVE}') and visibility_status <> 'excluded') then
      raise exception 'exclude transition failed';
    end if;
    if (select review_version from public.social_threads where id='${THREAD_REVIEW}') <> 1
       or (select review_version from public.social_threads where id='${THREAD_APPROVED}') <> 4
       or (select review_version from public.social_threads where id='${THREAD_ACTIVE}') <> 8 then
      raise exception 'exclude must increment exactly once';
    end if;
    if (select count(*) from public.social_review_events) <> 3 or (select count(*) from public.social_review_batches) <> 3 then
      raise exception 'one batch and event required per correction';
    end if;
    if exists (
      select 1 from public.social_review_events e
      where e.before_state->>'visibility_status' not in ('review','approved','active')
         or e.after_state->>'visibility_status' <> 'excluded'
         or (e.after_state->>'review_version')::int <> e.resulting_version
         or e.actor_user_id <> '${ADMIN}'
    ) then raise exception 'audit before/after state is inaccurate'; end if;
    if exists (select 1 from public.social_threads where id in ('${THREAD_REVIEW}','${THREAD_APPROVED}','${THREAD_ACTIVE}') and (reviewed_at is null or reviewed_by <> '${ADMIN}')) then
      raise exception 'review attribution missing';
    end if;
  end $$;`);

  sql(call(ADMIN, 'district-a', THREAD_REVIEW, 'restore', 1, 'life-restore-001'));
  sql(`do $$ begin
    if (select visibility_status from public.social_threads where id='${THREAD_REVIEW}') <> 'active' then raise exception 'restore must return excluded to active'; end if;
    if (select review_version from public.social_threads where id='${THREAD_REVIEW}') <> 2 then raise exception 'restore must increment exactly once'; end if;
    if not exists (
      select 1 from public.social_review_events
      where social_thread_id='${THREAD_REVIEW}' and action='restore'
        and before_state->>'visibility_status'='excluded'
        and before_state->>'review_version'='1'
        and after_state->>'visibility_status'='active'
        and after_state->>'review_version'='2'
        and resulting_version=2
    ) then raise exception 'restore audit before/after state is inaccurate'; end if;
  end $$;`);

  const beforeFailures = sql('select count(*) from public.social_review_events;');
  expectFailure(call(ADMIN, 'district-a', THREAD_REVIEW, 'restore', 2, 'bad-transition-01'), /Only excluded social results can be restored/);
  expectFailure(call(ADMIN, 'district-a', THREAD_ACTIVE, 'exclude', 6, 'stale-version-01'), /Social result changed/);
  expectFailure(call(ADMIN, 'district-b', THREAD_ACTIVE, 'restore', 8, 'district-mismatch'), /district does not match/i);
  expectFailure(call(ADMIN, 'district-a', THREAD_ACTIVE, 'approve', 8, 'unsupported-act1'), /Unsupported social correction action/);
  expectFailure(call(CLIENT, 'district-a', THREAD_ACTIVE, 'restore', 8, 'client-denied-001'), /reviewer access is required/i);
  expectFailure(call(ADMIN, 'district-a', THREAD_ACTIVE, 'restore', 8, 'bad key'), /idempotency key/i);
  sql(`do $$ begin
    if exists (
      select 1 from public.social_correction_requests
      where idempotency_key in ('bad-transition-01','stale-version-01','district-mismatch','unsupported-act1','client-denied-001','bad key')
    ) then raise exception 'failed correction stranded an idempotency claim'; end if;
  end $$;`);
  assert.equal(sql('select count(*) from public.social_review_events;'), beforeFailures, 'rejected corrections must not mutate audit state');

  const sequentialFirst = sql(call(ADMIN, 'district-a', THREAD_ACTIVE, 'restore', 8, 'sequential-same-1'));
  sql(`update public.social_threads set headline='fresh database value after completed correction' where id='${THREAD_ACTIVE}';`);
  const sequentialReplay = sql(call(ADMIN, 'district-a', THREAD_ACTIVE, 'restore', 8, 'sequential-same-1'));
  assert.equal(sequentialReplay, sequentialFirst, 'idempotent replay must return the historical completed snapshot, not a fresh row read');
  sql(`do $$ begin
    if (select review_version from public.social_threads where id='${THREAD_ACTIVE}') <> 9 then raise exception 'sequential replay incremented twice'; end if;
    if (select count(*) from public.social_review_events where social_thread_id='${THREAD_ACTIVE}' and action='restore') <> 1 then raise exception 'sequential replay audited twice'; end if;
  end $$;`);
  expectFailure(call(ADMIN, 'district-a', THREAD_REVIEW, 'exclude', 2, 'sequential-same-1'), /idempotency key was already used for a different request/i);

  const duplicateSql = call(ADMIN, 'district-a', THREAD_DUP, 'exclude', 0, 'concurrent-same-1');
  const duplicateResults = await Promise.all([sqlAsync(duplicateSql), sqlAsync(duplicateSql)]);
  assert.equal(duplicateResults[1], duplicateResults[0], 'concurrent duplicates must return the same completed row');
  sql(`do $$ begin
    if (select review_version from public.social_threads where id='${THREAD_DUP}') <> 1 then raise exception 'concurrent duplicate incremented more than once'; end if;
    if (select count(*) from public.social_review_events where social_thread_id='${THREAD_DUP}') <> 1 then raise exception 'concurrent duplicate audited more than once'; end if;
    if (select count(*) from public.social_correction_requests where actor_user_id='${ADMIN}' and idempotency_key='concurrent-same-1' and completed_at is not null) <> 1 then raise exception 'concurrent duplicate did not share one completed claim'; end if;
  end $$;`);

  expectFailure('update public.social_review_events set action=action where social_thread_id is not null;', /immutable/i);
  expectFailure('delete from public.social_review_batches;', /immutable/i);

  // SECURITY DEFINER service_role callers must pass the authenticated actor UUID for authorization and audit.
  sql(call(ADMIN, 'district-a', THREAD_DUP, 'restore', 1, 'service-role-0001'), { role: 'service_role' });
  sql(`select (public.canary_ingest_social_thread('{"district_id":"district-a","social_account_id":"11111111-1111-1111-1111-111111111111","provider":"meta","platform":"facebook","external_thread_id":"service-ingest-1","canonical_url":"https://facebook.test/service-ingest-1","relationship_type":"owned","published_at":"2026-08-04T12:00:00Z","visibility_status":"review"}'::jsonb)).*;`, { role: 'service_role' });

  for (const role of ['anon', 'authenticated']) {
    expectFailure(call(ADMIN, 'district-a', THREAD_DUP, 'exclude', 1, `role-denied-${role}`), /permission denied/i, { role });
    expectFailure(`select (public.canary_ingest_social_thread('{"district_id":"district-a"}'::jsonb)).*;`, /permission denied/i, { role });
    const privilege = sql(`select has_table_privilege('${role}', 'public.social_correction_requests', 'select,insert,update,delete');`);
    assert.match(privilege, /\bf\b/, `${role} must have no idempotency table privileges`);
  }
  for (const signature of [
    'public.canary_apply_social_correction(uuid,text,uuid,text,integer,text)',
    'public.canary_ingest_social_thread(jsonb)',
  ]) {
    assert.match(sql(`select has_function_privilege('service_role', '${signature}', 'execute');`), /\bt\b/);
    assert.match(sql(`select has_function_privilege('anon', '${signature}', 'execute');`), /\bf\b/);
    assert.match(sql(`select has_function_privilege('authenticated', '${signature}', 'execute');`), /\bf\b/);
  }
  assert.match(sql(`select has_table_privilege('service_role', 'public.social_correction_requests', 'select,insert,update,delete');`), /\bf\b/, 'service_role must use the correction RPC rather than the claim table');

  console.log('Social lifecycle PostgreSQL integration tests passed: transitions, audit, authorization, idempotency, and concurrency.');
});
