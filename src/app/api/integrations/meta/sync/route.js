import { requireIntegrationActor, integrationErrorResponse } from '@/lib/integration-auth';
import { metaIntegrationEnabledForDistrict } from '@/lib/meta-integration.mjs';
import { syncSelectedMetaAssets } from '@/lib/meta-sync-service.mjs';
import { sanitizeMetaSyncResult } from '@/lib/meta-recurring-sync.mjs';


export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const body = await request.json();
    const { actor, admin } = await requireIntegrationActor(body?.districtId || null);
    if (!metaIntegrationEnabledForDistrict(actor.districtId)) {
      return Response.json({ error: 'Meta integration is not available for this district.' }, { status: 503 });
    }
    const connectionId = String(body?.connectionId || '');
    const platform = String(body?.platform || '');
    if (!connectionId) return Response.json({ error: 'A Meta connection is required.' }, { status: 400 });
    if (!['facebook', 'instagram'].includes(platform)) {
      return Response.json({ error: 'Choose Facebook or Instagram for the bounded pilot sync.' }, { status: 400 });
    }
    const result = await syncSelectedMetaAssets({
      admin,
      districtId: actor.districtId,
      connectionId,
      pilotItemLimit: 2,
      platforms: [platform],
    });
    const sanitized = sanitizeMetaSyncResult(result);
    return Response.json(sanitized, { status: result.status === 'failed' ? 503 : 200 });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
