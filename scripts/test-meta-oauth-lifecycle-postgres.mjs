import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withSocialDatabase } from './fixtures/social-db-harness.mjs';

const CONNECTION = '10000000-0000-4000-8000-000000000011';
const ATTEMPT_DISCONNECT = '30000000-0000-4000-8000-000000000011';
const ATTEMPT_RECONNECT = '30000000-0000-4000-8000-000000000012';
const ATTEMPT_DELETE = '30000000-0000-4000-8000-000000000013';
const ATTEMPT_FAILURE = '30000000-0000-4000-8000-000000000014';
const ATTEMPT_CONCURRENT_A = '30000000-0000-4000-8000-000000000015';
const ATTEMPT_CONCURRENT_B = '30000000-0000-4000-8000-000000000016';
const ATTEMPT_FINALIZE_FIRST = '30000000-0000-4000-8000-000000000017';
const ATTEMPT_NEW_FAILURE = '30000000-0000-4000-8000-000000000018';
const ATTEMPT_EXPIRED = '30000000-0000-4000-8000-000000000019';
const ATTEMPT_AFTER_EXPIRED = '30000000-0000-4000-8000-000000000020';
const ATTEMPT_PREPARE_AFTER_DELETION = '30000000-0000-4000-8000-000000000021';
const ATTEMPT_PREPARE_DURING_DELETION = '30000000-0000-4000-8000-000000000022';
const AUTH_USER = '20000000-0000-4000-8000-000000000001';

const identityHash = (user) => `hash-${user}`;

function prepare({ attempt, district = 'district-meta', connection = CONNECTION, version = 1, user = 'user-1' }) {
  return `select public.test_prepare_meta_connection('${attempt}','${district}','${user}','${identityHash(user)}',${connection ? `'${connection}'` : 'null'},${version ?? 'null'});`;
}

function finalize({ attempt, district = 'district-meta', connection = CONNECTION, user = 'user-1', token = 'encrypted-token-new' }) {
  return `select public.canary_finalize_meta_connection('${attempt}','${connection}','${district}','${AUTH_USER}','app-1','${user}','${identityHash(user)}',null,'active',now()+interval '30 days','{pages_show_list}'::text[],'{}'::text[],'${token}',1,'[]'::jsonb);`;
}

await withSocialDatabase('meta-oauth-lifecycle', async ({ sql, expectFailure, session, waitForBlocked }) => {
  sql(`
    alter table public.social_accounts
      add column authorization_mode text not null default 'public',
      add column connection_status text not null default 'discovered',
      add column credential_reference text,
      add column granted_scopes jsonb not null default '[]'::jsonb,
      add column connected_at timestamptz,
      add column token_expires_at timestamptz,
      add column last_successful_sync_at timestamptz,
      add column last_error_at timestamptz,
      add column last_error_code text,
      add column created_at timestamptz not null default now(),
      add column updated_at timestamptz not null default now(),
      add constraint social_accounts_id_district_key unique (id, district_id);
    alter table public.social_threads add constraint social_threads_id_district_unique unique (id, district_id);
    alter table public.social_threads alter column visibility_status set default 'active';
    update public.social_threads set visibility_status='active' where visibility_status in ('review','approved');
    alter table public.social_threads drop constraint social_threads_visibility_status_check;
    alter table public.social_threads add constraint social_threads_visibility_status_check check (visibility_status in ('active','excluded'));
  `);
  const files = await Promise.all([
    '../supabase/meta_social_integration.sql',
    '../supabase/migrations/20260813224000_meta_owned_social_sync.sql',
    '../supabase/migrations/20260814223000_meta_owned_social_insights.sql',
    '../supabase/manual/canary_meta_database_final_current_state.sql',
    '../supabase/migrations/20260818190000_meta_oauth_attempt_lifecycle.sql',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const file of files) sql(file);
  const verifier = await readFile(new URL('../supabase/verify_meta_social_integration_consolidated.sql', import.meta.url), 'utf8');
  const verificationOutput = sql(verifier);
  assert.ok(!/\|\s*f\s*$/m.test(verificationOutput), `Consolidated Meta verifier reported a failed check:\n${verificationOutput}`);

  sql(`
    insert into auth.users(id) values ('${AUTH_USER}');
    insert into public.districts(id,name) values
      ('district-meta','District Meta'),
      ('district-concurrent','District Concurrent'),
      ('district-finalize-first','District Finalize First'),
      ('district-new','District New'),
      ('district-pre-prepare','District Pre Prepare'),
      ('district-provider-global','District Provider Global');
    insert into public.social_provider_connections(id,district_id,provider,provider_app_id,provider_user_id,status,lifecycle_version)
    values
      ('${CONNECTION}','district-meta','meta','app-1','user-1','active',1),
      ('10000000-0000-4000-8000-000000000012','district-concurrent','meta','app-1','user-2','active',1),
      ('10000000-0000-4000-8000-000000000013','district-finalize-first','meta','app-1','user-3','active',1);
    insert into public.social_provider_credentials(connection_id,district_id,encrypted_access_token,key_version)
    values
      ('${CONNECTION}','district-meta','healthy-token',1),
      ('10000000-0000-4000-8000-000000000012','district-concurrent','concurrent-token',1),
      ('10000000-0000-4000-8000-000000000013','district-finalize-first','finalize-first-token',1);

    create or replace function public.test_prepare_meta_connection(
      p_attempt uuid, p_district text, p_user text, p_user_hash text,
      p_connection uuid, p_version bigint
    ) returns uuid language plpgsql as \$\$
    begin
      insert into public.social_provider_oauth_states(
        state_hash,provider,user_id,district_id,return_path,expires_at,
        consumed_at,oauth_attempt_id,expected_connection_id,expected_lifecycle_version
      ) values (
        'state-' || p_attempt::text,'meta','${AUTH_USER}',p_district,
        '/dashboard/integrations',now()+interval '10 minutes',now(),p_attempt,
        p_connection,p_version
      ) on conflict (state_hash) do nothing;
      return public.canary_prepare_meta_connection(
        p_attempt,p_district,'${AUTH_USER}','app-1',p_user,p_user_hash,null,
        p_connection,p_version
      );
    end;
    \$\$;
  `);

  // Disconnect wins: callback blocks on the lifecycle lock, then fails stale.
  sql(prepare({ attempt: ATTEMPT_DISCONNECT }));
  const disconnector = session('oauth-disconnector');
  const staleCallback = session('oauth-stale-callback');
  await disconnector.exec('begin;');
  await disconnector.exec(`select public.canary_disconnect_meta_connection('${CONNECTION}','district-meta',false);`);
  const disconnectorPid = await disconnector.pid();
  const staleCallbackPid = await staleCallback.pid();
  const blockedFinalize = staleCallback.exec(finalize({ attempt: ATTEMPT_DISCONNECT }), 10000);
  await waitForBlocked(staleCallbackPid, disconnectorPid);
  await disconnector.exec('commit;');
  await assert.rejects(blockedFinalize, /Stale Meta OAuth callback/i);
  assert.equal(sql(`copy (select status||'|'||lifecycle_version||'|'||(select count(*) from public.social_provider_credentials k where k.connection_id=c.id) from public.social_provider_connections c where id='${CONNECTION}') to stdout;`).trim(), 'revoked|2|0');

  // Explicit reconnect after disconnect succeeds and establishes the next snapshot.
  sql(prepare({ attempt: ATTEMPT_RECONNECT, version: 2 }));
  sql(finalize({ attempt: ATTEMPT_RECONNECT, token: 'healthy-token-reconnected' }));
  assert.equal(sql(`copy (select status||'|'||lifecycle_version from public.social_provider_connections where id='${CONNECTION}') to stdout;`).trim(), 'active|3');

  // Confirmed data deletion wins: callback cannot recreate the deleted connection.
  sql(prepare({ attempt: ATTEMPT_DELETE, version: 3 }));
  const deleter = session('oauth-deleter');
  const deletedCallback = session('oauth-deleted-callback');
  await deleter.exec('begin;');
  await deleter.exec(`select public.canary_complete_meta_data_deletion('user-1','hash-user-1','delete-confirmation-1');`);
  const deleterPid = await deleter.pid();
  const deletedCallbackPid = await deletedCallback.pid();
  const blockedDeletedFinalize = deletedCallback.exec(finalize({ attempt: ATTEMPT_DELETE }), 10000);
  await waitForBlocked(deletedCallbackPid, deleterPid);
  await deleter.exec('commit;');
  await assert.rejects(blockedDeletedFinalize, /Stale Meta OAuth callback/i);
  assert.equal(sql(`copy (select count(*) from public.social_provider_connections where id='${CONNECTION}') to stdout;`).trim(), '0');
  assert.equal(sql(`copy (select status from public.social_provider_deletion_requests where confirmation_code='delete-confirmation-1') to stdout;`).trim(), 'completed');

  // A provider deletion can arrive after Meta issued a grant but before the
  // callback prepares any local connection. The completed identity fence must
  // reject that older state instead of recreating data after confirmation.
  sql(`insert into public.social_provider_oauth_states(state_hash,provider,user_id,district_id,return_path,created_at,expires_at,consumed_at,oauth_attempt_id)
    values('state-${ATTEMPT_PREPARE_AFTER_DELETION}','meta','${AUTH_USER}','district-pre-prepare','/dashboard/integrations',now()-interval '1 minute',now()+interval '9 minutes',now(),'${ATTEMPT_PREPARE_AFTER_DELETION}');`);
  sql(`select public.canary_complete_meta_data_deletion('user-5','${identityHash('user-5')}','delete-confirmation-pre-prepare');`);
  expectFailure(prepare({ attempt: ATTEMPT_PREPARE_AFTER_DELETION, district: 'district-pre-prepare', connection: null, version: null, user: 'user-5' }), /provider identity was deleted/i);
  assert.equal(sql(`copy (select count(*) from public.social_provider_connections where district_id='district-pre-prepare') to stdout;`).trim(), '0');

  // The provider-user lock spans districts and the no-connection case. A
  // callback that reaches prepare while deletion is uncommitted must wait,
  // then observe the completed fence rather than create a fresh connection.
  sql(`insert into public.social_provider_oauth_states(state_hash,provider,user_id,district_id,return_path,created_at,expires_at,consumed_at,oauth_attempt_id)
    values('state-${ATTEMPT_PREPARE_DURING_DELETION}','meta','${AUTH_USER}','district-provider-global','/dashboard/integrations',now()-interval '1 minute',now()+interval '9 minutes',now(),'${ATTEMPT_PREPARE_DURING_DELETION}');`);
  const identityDeleter = session('oauth-provider-global-deleter');
  const prePrepareCallback = session('oauth-provider-global-callback');
  await identityDeleter.exec('begin;');
  await identityDeleter.exec(`select public.canary_complete_meta_data_deletion('user-6','${identityHash('user-6')}','delete-confirmation-global');`);
  const identityDeleterPid = await identityDeleter.pid();
  const prePrepareCallbackPid = await prePrepareCallback.pid();
  const blockedPrePrepare = prePrepareCallback.exec(prepare({ attempt: ATTEMPT_PREPARE_DURING_DELETION, district: 'district-provider-global', connection: null, version: null, user: 'user-6' }), 10000);
  await waitForBlocked(prePrepareCallbackPid, identityDeleterPid);
  await identityDeleter.exec('commit;');
  await assert.rejects(blockedPrePrepare, /provider identity was deleted/i);
  assert.equal(sql(`copy (select count(*) from public.social_provider_connections where district_id='district-provider-global') to stdout;`).trim(), '0');

  // One callback owns the district attempt. A concurrent callback cannot prepare,
  // and remains stale after the winner increments the lifecycle version.
  const concurrentConnection = '10000000-0000-4000-8000-000000000012';
  expectFailure(prepare({ attempt: '30000000-0000-4000-8000-000000000023', district: 'district-concurrent', connection: concurrentConnection, version: 1, user: 'different-user' }), /different Meta identity/i);
  assert.equal(sql(`copy (select provider_user_id from public.social_provider_connections where id='${concurrentConnection}') to stdout;`).trim(), 'user-2');
  sql(prepare({ attempt: ATTEMPT_CONCURRENT_A, district: 'district-concurrent', connection: concurrentConnection, version: 1, user: 'user-2' }));
  expectFailure(prepare({ attempt: ATTEMPT_CONCURRENT_B, district: 'district-concurrent', connection: concurrentConnection, version: 1, user: 'user-2' }), /already in progress/i);
  sql(finalize({ attempt: ATTEMPT_CONCURRENT_A, district: 'district-concurrent', connection: concurrentConnection, user: 'user-2' }));
  expectFailure(prepare({ attempt: ATTEMPT_CONCURRENT_B, district: 'district-concurrent', connection: concurrentConnection, version: 1, user: 'user-2' }), /Stale Meta OAuth callback/i);
  assert.equal(sql(`copy (select status||'|'||lifecycle_version from public.social_provider_connections where id='${concurrentConnection}') to stdout;`).trim(), 'active|2');

  // Callback wins first, then disconnect waits and still leaves terminal state.
  const finalizeFirstConnection = '10000000-0000-4000-8000-000000000013';
  sql(prepare({ attempt: ATTEMPT_FINALIZE_FIRST, district: 'district-finalize-first', connection: finalizeFirstConnection, version: 1, user: 'user-3' }));
  const winningCallback = session('oauth-winning-callback');
  const waitingDisconnect = session('oauth-waiting-disconnect');
  await winningCallback.exec('begin;');
  await winningCallback.exec(finalize({ attempt: ATTEMPT_FINALIZE_FIRST, district: 'district-finalize-first', connection: finalizeFirstConnection, user: 'user-3' }));
  const winningCallbackPid = await winningCallback.pid();
  const waitingDisconnectPid = await waitingDisconnect.pid();
  const blockedDisconnect = waitingDisconnect.exec(`select public.canary_disconnect_meta_connection('${finalizeFirstConnection}','district-finalize-first',false);`, 10000);
  await waitForBlocked(waitingDisconnectPid, winningCallbackPid);
  await winningCallback.exec('commit;');
  await blockedDisconnect;
  assert.equal(sql(`copy (select status||'|'||(select count(*) from public.social_provider_credentials k where k.connection_id=c.id) from public.social_provider_connections c where id='${finalizeFirstConnection}') to stdout;`).trim(), 'revoked|0');

  // Failed reconnect abandons only its attempt; healthy status, version, and token survive.
  const concurrentVersion = Number(sql(`copy (select lifecycle_version from public.social_provider_connections where id='${concurrentConnection}') to stdout;`).trim());
  sql(prepare({ attempt: ATTEMPT_FAILURE, district: 'district-concurrent', connection: concurrentConnection, version: concurrentVersion, user: 'user-2' }));
  sql(`select public.canary_abandon_meta_connection_attempt('${ATTEMPT_FAILURE}','district-concurrent');`);
  assert.equal(sql(`copy (select status||'|'||lifecycle_version||'|'||(select encrypted_access_token from public.social_provider_credentials where connection_id=c.id) from public.social_provider_connections c where id='${concurrentConnection}') to stdout;`).trim(), `active|${concurrentVersion}|encrypted-token-new`);

  // A crashed callback claim expires locally and cannot block all future retries.
  sql(prepare({ attempt: ATTEMPT_EXPIRED, district: 'district-concurrent', connection: concurrentConnection, version: concurrentVersion, user: 'user-2' }));
  sql(`update public.social_provider_connection_attempts set expires_at=now()-interval '1 second' where attempt_id='${ATTEMPT_EXPIRED}';`);
  sql(prepare({ attempt: ATTEMPT_AFTER_EXPIRED, district: 'district-concurrent', connection: concurrentConnection, version: concurrentVersion, user: 'user-2' }));
  assert.equal(sql(`copy (select status from public.social_provider_connection_attempts where attempt_id='${ATTEMPT_EXPIRED}') to stdout;`).trim(), 'abandoned');
  sql(`select public.canary_abandon_meta_connection_attempt('${ATTEMPT_AFTER_EXPIRED}','district-concurrent');`);

  // A failed first connection has no credential to preserve and is removed locally.
  const newConnection = sql(`copy (${prepare({ attempt: ATTEMPT_NEW_FAILURE, district: 'district-new', connection: null, version: null, user: 'user-4' }).replace(/;$/, '')}) to stdout;`).trim();
  assert.ok(newConnection);
  sql(`select public.canary_abandon_meta_connection_attempt('${ATTEMPT_NEW_FAILURE}','district-new');`);
  assert.equal(sql(`copy (select count(*) from public.social_provider_connections where district_id='district-new') to stdout;`).trim(), '0');

  expectFailure(finalize({ attempt: ATTEMPT_FAILURE, district: 'district-concurrent', connection: concurrentConnection, user: 'user-2', token: 'token' }), /no longer pending/i);
  expectFailure(prepare({ attempt: '30000000-0000-4000-8000-000000000099', district: 'district-concurrent', connection: concurrentConnection, version: concurrentVersion - 1, user: 'user-2' }), /Stale Meta OAuth callback/i);
});

console.log('Meta OAuth PostgreSQL lifecycle interleavings passed.');
