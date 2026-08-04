import assert from 'node:assert/strict';
import { withSocialDatabase } from './fixtures/social-db-harness.mjs';

const ADMIN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCOUNT = '11111111-1111-1111-1111-111111111111';
const ids = {
  correctionFirst: '50000000-0000-0000-0000-000000000001',
  ingestionFirst: '50000000-0000-0000-0000-000000000002',
  stalePair: '50000000-0000-0000-0000-000000000003',
  orderedPair: '50000000-0000-0000-0000-000000000004',
  legacySingle: '50000000-0000-0000-0000-000000000005',
  legacyBulk: '50000000-0000-0000-0000-000000000006',
};
const correction = (id, action, version, key) =>
  `select (public.canary_apply_social_correction('${ADMIN}', 'district-a', '${id}', '${action}', ${version}, '${key}')).id;`;
const legacy = (id, action, version) =>
  `select (public.canary_review_social_thread('${ADMIN}', '${id}', '${action}', ${version}, null, null)).id;`;
const bulk = (id) =>
  `select * from public.canary_bulk_review_social_threads('${ADMIN}', 'district-a', array['${id}'::uuid], 'promote');`;
const payload = (externalId, headline) => ({
  district_id: 'district-a', social_account_id: ACCOUNT, provider: 'meta', platform: 'facebook',
  external_thread_id: externalId, canonical_url: `https://facebook.test/${externalId}`,
  relationship_type: 'owned', headline, body: headline, published_at: '2026-08-01T12:00:00Z',
  first_seen_at: '2026-08-01T13:00:00Z', last_seen_at: '2026-08-04T13:00:00Z',
  visibility_status: 'active', provider_metadata: { race: headline },
});
const ingest = (externalId, headline) =>
  `select (public.canary_ingest_social_thread($payload$${JSON.stringify(payload(externalId, headline))}$payload$::jsonb)).id;`;

await withSocialDatabase('ordered-races', async ({ sql, session, waitForBlocked }) => {
  sql(`insert into public.social_threads
    (id,district_id,social_account_id,provider,platform,external_thread_id,canonical_url,relationship_type,headline,body,published_at,visibility_status,review_version)
    values
    ('${ids.correctionFirst}','district-a','${ACCOUNT}','meta','facebook','race-a','https://facebook.test/race-a','owned','initial a','initial a',now(),'active',0),
    ('${ids.ingestionFirst}','district-a','${ACCOUNT}','meta','facebook','race-b','https://facebook.test/race-b','owned','initial b','initial b',now(),'active',0),
    ('${ids.stalePair}','district-a','${ACCOUNT}','meta','facebook','race-c','https://facebook.test/race-c','owned','initial c','initial c',now(),'excluded',0),
    ('${ids.orderedPair}','district-a','${ACCOUNT}','meta','facebook','race-d','https://facebook.test/race-d','owned','initial d','initial d',now(),'active',0),
    ('${ids.legacySingle}','district-a','${ACCOUNT}','meta','facebook','race-e','https://facebook.test/race-e','owned','initial e','initial e',now(),'active',0),
    ('${ids.legacyBulk}','district-a','${ACCOUNT}','meta','facebook','race-f','https://facebook.test/race-f','owned','initial f','initial f',now(),'review',0);`);

  let sessionCounter = 0;
  async function orderedRace(id, firstSql, secondSql, { firstMayFail = false, secondMayFail = false } = {}) {
    const suffix = sessionCounter += 1;
    const holder = session(`holder${suffix}`);
    const first = session(`first${suffix}`);
    const second = session(`second${suffix}`);
    const holderPid = await holder.pid();
    const firstPid = await first.pid();
    const secondPid = await second.pid();
    await holder.exec(`begin; select id from public.social_threads where id='${id}' for update;`);
    const firstPromise = first.exec(firstSql);
    const firstBarrier = await waitForBlocked(firstPid, holderPid);
    const secondPromise = second.exec(secondSql);
    const secondBarrier = await waitForBlocked(secondPid);
    await holder.exec('commit;');
    const firstResult = firstMayFail ? await Promise.allSettled([firstPromise]) : [{ status: 'fulfilled', value: await firstPromise }];
    const secondResult = secondMayFail ? await Promise.allSettled([secondPromise]) : [{ status: 'fulfilled', value: await secondPromise }];
    holder.close(); first.close(); second.close();
    return { first: firstResult[0], second: secondResult[0], firstBarrier, secondBarrier };
  }

  // A: correction is demonstrably queued first, then ingestion refreshes only provider content.
  const a = await orderedRace(ids.correctionFirst, correction(ids.correctionFirst, 'exclude', 0, 'race-a-exclude'), ingest('race-a', 'refreshed after hide'));
  assert.match(a.firstBarrier, /^Lock\|/); assert.match(a.secondBarrier, /^Lock\|/);
  sql(`do $$ begin
    if (select visibility_status from public.social_threads where id='${ids.correctionFirst}') <> 'excluded'
       or (select review_version from public.social_threads where id='${ids.correctionFirst}') <> 1
       or (select headline from public.social_threads where id='${ids.correctionFirst}') <> 'refreshed after hide'
       or (select count(*) from public.social_review_events where social_thread_id='${ids.correctionFirst}') <> 1
    then raise exception 'scenario A invariant failed'; end if;
  end $$;`);

  // B: ingestion is queued first, correction follows, and the trusted association survives both.
  const b = await orderedRace(ids.ingestionFirst, ingest('race-b', 'refreshed before hide'), correction(ids.ingestionFirst, 'exclude', 0, 'race-b-exclude'));
  assert.match(b.firstBarrier, /^Lock\|/); assert.match(b.secondBarrier, /^Lock\|/);
  sql(`do $$ begin
    if (select visibility_status from public.social_threads where id='${ids.ingestionFirst}') <> 'excluded'
       or (select review_version from public.social_threads where id='${ids.ingestionFirst}') <> 1
       or (select headline from public.social_threads where id='${ids.ingestionFirst}') <> 'refreshed before hide'
       or (select social_account_id from public.social_threads where id='${ids.ingestionFirst}') <> '${ACCOUNT}'
       or (select provider from public.social_threads where id='${ids.ingestionFirst}') <> 'meta'
       or (select count(*) from public.social_review_events where social_thread_id='${ids.ingestionFirst}') <> 1
    then raise exception 'scenario B invariant failed'; end if;
  end $$;`);

  // C: different keys and actions share expected v0. Restore wins; exclude rolls back its claim as stale.
  const c = await orderedRace(ids.stalePair,
    correction(ids.stalePair, 'restore', 0, 'race-c-restore'),
    correction(ids.stalePair, 'exclude', 0, 'race-c-exclude'), { secondMayFail: true });
  assert.equal(c.first.status, 'fulfilled');
  assert.equal(c.second.status, 'rejected');
  assert.match(c.second.reason.message, /changed; refresh/i);
  sql(`do $$ begin
    if (select review_version from public.social_threads where id='${ids.stalePair}') <> 1
       or (select visibility_status from public.social_threads where id='${ids.stalePair}') <> 'active'
       or (select count(*) from public.social_review_events where social_thread_id='${ids.stalePair}') <> 1
       or exists (select 1 from public.social_correction_requests where idempotency_key='race-c-exclude')
    then raise exception 'scenario C stale loser left mutation, event, or claim'; end if;
  end $$;`);

  // D: two distinct keys serialize as exclude v0 then restore v1, exactly two versions and events.
  await orderedRace(ids.orderedPair,
    correction(ids.orderedPair, 'exclude', 0, 'race-d-exclude'),
    correction(ids.orderedPair, 'restore', 1, 'race-d-restore'));
  sql(`do $$ begin
    if (select review_version from public.social_threads where id='${ids.orderedPair}') <> 2
       or (select visibility_status from public.social_threads where id='${ids.orderedPair}') <> 'active'
       or (select count(*) from public.social_review_events where social_thread_id='${ids.orderedPair}') <> 2
       or (select array_agg(resulting_version order by resulting_version) from public.social_review_events where social_thread_id='${ids.orderedPair}') <> array[1,2]
    then raise exception 'scenario D did not serialize to exact versions 1 and 2'; end if;
  end $$;`);

  // E1 uses the faithful N-1 single-row RPC loaded by the harness, queued before ingestion.
  await orderedRace(ids.legacySingle, legacy(ids.legacySingle, 'exclude', 0), ingest('race-e', 'legacy hidden refresh'));
  sql(`do $$ begin
    if (select visibility_status from public.social_threads where id='${ids.legacySingle}') <> 'excluded'
       or (select review_version from public.social_threads where id='${ids.legacySingle}') <> 1
       or (select headline from public.social_threads where id='${ids.legacySingle}') <> 'legacy hidden refresh'
       or (select count(*) from public.social_review_events where social_thread_id='${ids.legacySingle}') <> 1
    then raise exception 'legacy single interleaving exposed or lost lifecycle'; end if;
  end $$;`);

  // E2 queues the new exclusion first and faithful N-1 bulk promotion second. Bulk rechecks eligibility under the shared row lock and rolls back.
  const e2 = await orderedRace(ids.legacyBulk,
    correction(ids.legacyBulk, 'exclude', 0, 'race-f-exclude'),
    bulk(ids.legacyBulk), { secondMayFail: true });
  assert.equal(e2.first.status, 'fulfilled');
  assert.equal(e2.second.status, 'rejected');
  assert.match(e2.second.reason.message, /ineligible social results/i);
  sql(`do $$ begin
    if (select visibility_status from public.social_threads where id='${ids.legacyBulk}') <> 'excluded'
       or (select review_version from public.social_threads where id='${ids.legacyBulk}') <> 1
       or (select count(*) from public.social_review_events where social_thread_id='${ids.legacyBulk}') <> 1
       or exists (select 1 from public.social_review_batches where criteria->'social_thread_ids' @> to_jsonb(array['${ids.legacyBulk}'::uuid]))
    then raise exception 'legacy bulk interleaving exposed lifecycle or left audit'; end if;
  end $$;`);

  console.log('Deterministic Social race tests passed: 12 Lock barriers observed across A-E; correction, ingestion, and faithful N-1 single/bulk RPCs serialized without deadlock.');
});
