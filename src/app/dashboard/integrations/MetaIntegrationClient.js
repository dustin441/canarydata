'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './integrations.module.css';

const STATUS_COPY = {
  connected: 'Meta access was connected. Select the Pages, Instagram accounts, and ad accounts Canary should use.',
  permissions_limited: 'Meta connected, but one or more requested permissions were not granted. Available assets are shown below.',
  cancelled: 'Meta authorization was cancelled. No access was added.',
  invalid_state: 'That authorization link expired or was already used. Start a new connection.',
  forbidden: 'That district connection is not available to this account.',
  start_failed: 'Canary could not start Meta authorization.',
  callback_failed: 'Meta returned access, but Canary could not finish the connection. No token was exposed.',
  not_configured: 'The Canary Meta application still needs its production App ID, secret, encryption key, and redirect URI.',
};

const GROUPS = [
  { type: 'facebook_page', title: 'Facebook Pages', description: 'Official Page posts and Page-level reporting.' },
  { type: 'instagram_account', title: 'Instagram accounts', description: 'Professional accounts connected to an authorized Facebook Page.' },
  { type: 'ad_account', title: 'Meta ad accounts', description: 'Read-only campaign delivery and paid-versus-organic reporting.' },
];

function statusClass(status) {
  return status === 'active' ? styles.statusActive : styles.statusMuted;
}

export default function MetaIntegrationClient({ districtId, districtName, districts, isAdmin, oauthStatus }) {
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!districtId) {
      setData(null);
      setDrafts({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/integrations/meta?districtId=${encodeURIComponent(districtId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Meta connection status could not be loaded.');
      setData(payload);
      setDrafts(Object.fromEntries((payload.accounts || []).map((account) => [account.id, {
        selected: account.selected,
      }])));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [districtId]);

  useEffect(() => { load(); }, [load]);

  const activeConnections = useMemo(() => (data?.connections || []).filter((connection) => ['active', 'needs_permissions'].includes(connection.status)), [data]);

  function updateDraft(id, patch) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function saveSelections() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const accounts = (data?.accounts || []).map((account) => ({ id: account.id, ...drafts[account.id] }));
      const response = await fetch('/api/integrations/meta/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ districtId, accounts }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Meta account selections could not be saved.');
      setMessage(`Saved ${payload.selectedCount} reporting asset${payload.selectedCount === 1 ? '' : 's'}.`);
      await load();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function disconnect(connectionId) {
    if (!window.confirm('Disconnect Meta and stop Canary from using this connection?')) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/integrations/meta/disconnect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ districtId, connectionId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Meta could not be disconnected.');
      setMessage(payload.remoteRevocationConfirmed
        ? 'Meta access was revoked and removed from Canary.'
        : 'Canary removed local access. Confirm revocation in Meta Business Integrations.');
      await load();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a className={styles.back} href="/dashboard">← Back to dashboard</a>
        <span className={styles.eyebrow}>Canary integrations</span>
        <h1>Connect Meta</h1>
        <p>Give Canary read-only access to official Facebook Pages, connected Instagram professional accounts, and Meta ad accounts.</p>
      </header>

      {isAdmin && (
        <label className={styles.districtPicker}>
          <span>Pilot district</span>
          <select value={districtId || ''} onChange={(event) => { if (event.target.value) window.location.href = `/dashboard/integrations?districtId=${encodeURIComponent(event.target.value)}`; }}>
            <option value="" disabled>Select one district</option>
            {districts.map((district) => <option key={district.id} value={district.id}>{district.name}</option>)}
          </select>
        </label>
      )}

      {oauthStatus && STATUS_COPY[oauthStatus] && <div className={styles.notice}>{STATUS_COPY[oauthStatus]}</div>}
      {message && <div className={styles.success} role="status">{message}</div>}
      {error && <div className={styles.error} role="alert">{error}</div>}

      {!districtId ? (
        <section className={styles.permissionCard}>
          <div>
            <span className={styles.eyebrow}>District required</span>
            <h2>Select one pilot district</h2>
            <p>Administrators must explicitly choose the district whose Meta connection they want to review or manage.</p>
          </div>
        </section>
      ) : <section className={styles.permissionCard}>
        <div>
          <span className={styles.eyebrow}>Read-only connection</span>
          <h2>{districtName}</h2>
          <p>Canary will use the selected assets for reporting and reconciliation. This connection cannot publish posts, reply to comments, change campaigns, or spend advertising budget.</p>
        </div>
        <div className={styles.permissionList}>
          <span>✓ Identify Pages and connected Instagram accounts</span>
          <span>✓ Authorize read-only ad-account access</span>
          <span>✓ Choose which assets Canary uses</span>
          <span>✓ Disconnect at any time</span>
        </div>
      </section>}

      {!districtId ? null : loading ? <div className={styles.loading}>Loading Meta connection status…</div> : (
        <>
          <section className={styles.connectionSection}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Connection</h2>
                <p>Meta will show the Pages and ad accounts available to the person signing in.</p>
              </div>
              {data?.configured ? (
                <form action="/api/integrations/meta/start" method="post">
                  <input type="hidden" name="districtId" value={districtId} />
                  <input type="hidden" name="returnPath" value={`/dashboard/integrations?districtId=${districtId}`} />
                  <button className={styles.connectButton} type="submit">{activeConnections.length ? 'Reconnect Meta' : 'Continue with Meta'}</button>
                </form>
              ) : <button className={styles.connectButton} disabled>Meta setup required</button>}
            </div>

            {activeConnections.length === 0 ? (
              <div className={styles.empty}>No active Meta connection for this district.</div>
            ) : activeConnections.map((connection) => (
              <article className={styles.connection} key={connection.id}>
                <div>
                  <span className={statusClass(connection.status)}>{connection.status}</span>
                  <h3>{connection.provider_user_name || 'Meta account'}</h3>
                  <p>Connected {new Date(connection.connected_at).toLocaleDateString()} · Token expiry {connection.token_expires_at ? new Date(connection.token_expires_at).toLocaleDateString() : 'not reported'}</p>
                  {connection.declined_scopes?.length > 0 && <small>Missing permissions: {connection.declined_scopes.join(', ')}</small>}
                </div>
                <button className={styles.disconnectButton} type="button" disabled={saving} onClick={() => disconnect(connection.id)}>Disconnect</button>
              </article>
            ))}
          </section>

          {(data?.accounts || []).length > 0 && (
            <section className={styles.assetsSection}>
              <div className={styles.sectionHeading}>
                <div><h2>Select reporting assets</h2><p>Only selected assets will be included in Canary reporting and future scheduled syncs.</p></div>
                <button className={styles.saveButton} type="button" disabled={saving} onClick={saveSelections}>{saving ? 'Saving…' : 'Save selections'}</button>
              </div>

              {GROUPS.map((group) => {
                const accounts = data.accounts.filter((account) => account.asset_type === group.type);
                return (
                  <div className={styles.assetGroup} key={group.type}>
                    <div><h3>{group.title}</h3><p>{group.description}</p></div>
                    {accounts.length === 0 ? <div className={styles.emptySmall}>No authorized {group.title.toLowerCase()} were returned.</div> : accounts.map((account) => {
                      const draft = drafts[account.id] || {};
                      return (
                        <article className={`${styles.asset} ${draft.selected ? styles.assetSelected : ''}`} key={account.id}>
                          <label className={styles.assetIdentity}>
                            <input type="checkbox" checked={Boolean(draft.selected)} onChange={(event) => updateDraft(account.id, { selected: event.target.checked })} />
                            <span><strong>{account.name}</strong><small>{account.handle ? `@${account.handle}` : account.provider_asset_id}</small></span>
                          </label>
                          {draft.selected && <small className={styles.mappingNote}>Mapped to {districtName}</small>}
                        </article>
                      );
                    })}
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}

      <footer className={styles.footer}>Canary stores Meta credentials encrypted on the server. Access tokens are never sent to the browser.</footer>
    </main>
  );
}
