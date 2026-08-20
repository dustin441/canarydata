import { createAdminClient } from '@/lib/supabase/admin';
import { metaIntegrationEnabledForDistrict } from '@/lib/meta-integration.mjs';
import { assertMetaNativeSyncFlags, syncSelectedMetaAssets } from '@/lib/meta-sync-service.mjs';
import { isAuthorizedCronRequest, recurringMetaSyncDecision, sanitizeMetaSyncResult } from '@/lib/meta-recurring-sync.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const EIC_DISTRICT_ID = 'canary-lesley-test-district';

function genericFailure() {
  return Response.json({ status: 'error' }, { status: 500 });
}

export async function GET(request) {
  if (!isAuthorizedCronRequest(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ status: 'unauthorized' }, { status: 401 });
  }

  try {
    const connectionId = process.env.META_EIC_SYNC_CONNECTION_ID;
    if (!connectionId) throw new Error('Recurring Meta synchronization is not configured.');
    if (!metaIntegrationEnabledForDistrict(EIC_DISTRICT_ID)) throw new Error('Recurring Meta synchronization is unavailable.');
    assertMetaNativeSyncFlags(null);

    const admin = createAdminClient();
    const { data: connection, error: connectionError } = await admin.from('social_provider_connections')
      .select('status,provider_app_id')
      .eq('id', connectionId).eq('district_id', EIC_DISTRICT_ID).eq('provider', 'meta').maybeSingle();
    if (connectionError || !connection || connection.status !== 'active'
      || String(connection.provider_app_id) !== String(process.env.META_APP_ID)) {
      throw new Error('Recurring Meta synchronization connection is unavailable.');
    }

    const { data: latestRun, error: latestRunError } = await admin.from('social_sync_runs')
      .select('status,completed_at,next_cursor')
      .eq('district_id', EIC_DISTRICT_ID).eq('connection_id', connectionId)
      .neq('status', 'running').order('started_at', { ascending: false }).limit(1).maybeSingle();
    if (latestRunError) throw new Error('Recurring Meta synchronization cadence is unavailable.');

    const decision = recurringMetaSyncDecision(latestRun);
    if (!decision.run) {
      return Response.json(sanitizeMetaSyncResult({ status: 'skipped' }));
    }

    const result = await syncSelectedMetaAssets({
      admin,
      districtId: EIC_DISTRICT_ID,
      connectionId,
      pilotItemLimit: null,
      contentMetricRefreshDays: 14,
    });
    const sanitized = sanitizeMetaSyncResult(result);
    return Response.json(sanitized, { status: result.status === 'failed' ? 503 : 200 });
  } catch {
    console.error('Meta EIC recurring sync failed.', { event: 'meta_eic_sync_failed' });
    return genericFailure();
  }
}
