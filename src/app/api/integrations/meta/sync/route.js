import { requireIntegrationActor, integrationErrorResponse } from '@/lib/integration-auth';
import { syncSelectedMetaAssets } from '@/lib/meta-sync-service.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const body = await request.json();
    const { actor, admin } = await requireIntegrationActor(body?.districtId || null);
    const connectionId = String(body?.connectionId || '');
    if (!connectionId) return Response.json({ error: 'A Meta connection is required.' }, { status: 400 });
    const result = await syncSelectedMetaAssets({
      admin,
      districtId: actor.districtId,
      connectionId,
      sourceCutoff: body?.sourceCutoff || null,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
