import assert from 'node:assert/strict';
import { withSocialDatabase } from './fixtures/social-db-harness.mjs';

const ADMIN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const THREAD_ID = '40000000-0000-0000-0000-000000000001';
const correction = (action, version, key) =>
  `select (public.canary_apply_social_correction('${ADMIN}', 'district-a', '${THREAD_ID}', '${action}', ${version}, '${key}')).*;`;
const ingest = (payload) => `select (public.canary_ingest_social_thread($payload$${JSON.stringify(payload)}$payload$::jsonb)).*;`;

const base = {
  district_id: 'district-a',
  social_account_id: '11111111-1111-1111-1111-111111111111',
  provider: 'meta',
  platform: 'facebook',
  external_thread_id: 'provider-post-42',
  canonical_url: 'https://facebook.test/posts/42',
  relationship_type: 'ambient',
  author_name: 'Original author',
  author_handle: 'original',
  headline: 'Original headline',
  body: 'Original body',
  summary: 'Original summary',
  recommendation: 'Original recommendation',
  published_at: '2026-08-01T12:00:00Z',
  first_seen_at: '2026-08-01T13:00:00Z',
  last_seen_at: '2026-08-01T13:00:00Z',
  comment_count: 1,
  reply_count: 2,
  reaction_count: 3,
  share_count: 4,
  view_count: 5,
  engagement_total: 10,
  sentiment: 'neutral',
  risk_level: 'low',
  canary_score: 2.5,
  tags: ['old'],
  strategic_alignment: ['priority-old'],
  matched_terms: ['old-term'],
  match_reason: 'old reason',
  identity_confidence: 0.8,
  visibility_status: 'review',
  provider_metadata: { generation: 1 },
};

await withSocialDatabase('replay', async ({ sql, sqlAsync, expectFailure }) => {
  sql(ingest(base));
  sql(`do $$ begin
    if (select count(*) from public.social_threads where district_id='district-a' and platform='facebook' and external_thread_id='provider-post-42') <> 1 then raise exception 'initial ingestion identity failed'; end if;
    if (select visibility_status from public.social_threads where external_thread_id='provider-post-42' and district_id='district-a') <> 'review' then raise exception 'supplied initial visibility was not used'; end if;
    update public.social_threads set id='${THREAD_ID}', relationship_type='direct_mention', reviewer_note='human note' where district_id='district-a' and platform='facebook' and external_thread_id='provider-post-42';
  end $$;`);

  sql(correction('exclude', 0, 'replay-exclude-01'));
  const replayActive = {
    ...base,
    visibility_status: 'active',
    relationship_type: 'owned',
    author_name: 'Refreshed author',
    headline: 'Refreshed headline',
    body: 'Refreshed body',
    summary: 'Refreshed summary',
    recommendation: 'Refreshed recommendation',
    last_seen_at: '2026-08-03T13:00:00Z',
    comment_count: 11,
    reply_count: 12,
    reaction_count: 13,
    share_count: 14,
    view_count: 15,
    engagement_total: 50,
    sentiment: 'positive',
    risk_level: 'medium',
    canary_score: 7.5,
    tags: ['new'],
    strategic_alignment: ['priority-new'],
    matched_terms: ['new-term'],
    match_reason: 'new reason',
    identity_confidence: 0.95,
    provider_metadata: { generation: 2 },
  };
  sql(ingest(replayActive));
  sql(ingest({ ...replayActive, visibility_status: 'review', headline: 'Latest while hidden', reaction_count: 23, provider_metadata: { generation: 3 } }));

  sql(`do $$ declare r public.social_threads%rowtype; begin
    select * into r from public.social_threads where id='${THREAD_ID}';
    if r.visibility_status <> 'excluded' or r.review_version <> 1 then raise exception 'excluded lifecycle was clobbered by replay'; end if;
    if r.reviewer_note <> 'human note' or r.reviewed_by <> '${ADMIN}' or r.reviewed_at is null then raise exception 'human review fields were clobbered'; end if;
    if r.relationship_type <> 'direct_mention' then raise exception 'human relationship classification was clobbered'; end if;
    if r.headline <> 'Latest while hidden' or r.reaction_count <> 23 or r.provider_metadata <> '{"generation":3}'::jsonb then raise exception 'allowed replay fields were not refreshed'; end if;
    if (select count(*) from public.social_review_events where social_thread_id='${THREAD_ID}') <> 1 then raise exception 'ingestion changed audit history'; end if;
  end $$;`);

  const parallelPayload = ingest({ ...replayActive, visibility_status: 'active', headline: 'Parallel refresh', reaction_count: 99, last_seen_at: '2026-08-04T13:00:00Z', provider_metadata: { generation: 4 } });
  await Promise.all(Array.from({ length: 8 }, () => sqlAsync(parallelPayload)));
  sql(`do $$ begin
    if (select count(*) from public.social_threads where district_id='district-a' and platform='facebook' and external_thread_id='provider-post-42') <> 1 then raise exception 'parallel replay created duplicate identities'; end if;
    if (select visibility_status from public.social_threads where id='${THREAD_ID}') <> 'excluded' then raise exception 'parallel replay exposed excluded row'; end if;
    if (select review_version from public.social_threads where id='${THREAD_ID}') <> 1 then raise exception 'parallel replay changed review version'; end if;
    if (select count(*) from public.social_review_events where social_thread_id='${THREAD_ID}') <> 1 then raise exception 'parallel replay changed audit'; end if;
  end $$;`);

  sql(correction('restore', 1, 'replay-restore-01'));
  sql(ingest({ ...base, visibility_status: 'review', body: 'Old payload replayed after restore', reaction_count: 31, last_seen_at: '2026-08-05T13:00:00Z' }));
  sql(`do $$ declare r public.social_threads%rowtype; begin
    select * into r from public.social_threads where id='${THREAD_ID}';
    if r.visibility_status <> 'active' or r.review_version <> 2 then raise exception 'old review payload clobbered restored active lifecycle'; end if;
    if r.relationship_type <> 'direct_mention' or r.reviewer_note <> 'human note' then raise exception 'old replay clobbered human fields'; end if;
    if r.body <> 'Old payload replayed after restore' or r.reaction_count <> 31 then raise exception 'content or metrics did not refresh after restore'; end if;
    if (select count(*) from public.social_review_events where social_thread_id='${THREAD_ID}') <> 2 then raise exception 'restore audit missing or multiplied'; end if;
  end $$;`);

  sql(ingest({ ...base, district_id: 'district-b', social_account_id: '22222222-2222-2222-2222-222222222222', visibility_status: 'excluded', body: 'District B independent identity' }));
  sql(`do $$ begin
    if (select count(*) from public.social_threads where platform='facebook' and external_thread_id='provider-post-42') <> 2 then raise exception 'district-scoped identities collided'; end if;
    if (select visibility_status from public.social_threads where district_id='district-b' and external_thread_id='provider-post-42') <> 'excluded' then raise exception 'new excluded status not honored'; end if;
  end $$;`);

  expectFailure(ingest({ ...base, external_thread_id: 'approved-not-allowed', visibility_status: 'approved' }), /visibility_status must be review, active, or excluded/i);
  const { visibility_status: omitted, ...missingVisibility } = { ...base, external_thread_id: 'missing-visibility' };
  assert.equal(omitted, 'review');
  expectFailure(ingest(missingVisibility), /visibility_status must be review, active, or excluded/i);
  expectFailure(ingest({ ...base, external_thread_id: 'negative-count', comment_count: -1 }), /metrics must be non-negative/i);
  expectFailure(ingest({ ...base, external_thread_id: 'wrong-account', social_account_id: '22222222-2222-2222-2222-222222222222' }), /social account does not match/i);

  console.log('Social exclusion replay PostgreSQL integration tests passed: atomic ingestion, lifecycle preservation, tenant identity, and parallel replay.');
});
