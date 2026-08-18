import { requireIntegrationActor, integrationErrorResponse } from '@/lib/integration-auth';
import { metaIntegrationEnabledForDistrict } from '@/lib/meta-integration.mjs';


export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const body = await request.json();
    const { actor, admin } = await requireIntegrationActor(body?.districtId || null);
    if (!metaIntegrationEnabledForDistrict(actor.districtId)) {
      return Response.json({ error: 'Meta integration is not available for this district.' }, { status: 503 });
    }
    // OAuth discovery can be piloted independently. Canonical writes remain
    // hard-disabled until each sync commit is transactionally bound to both
    // the connection lifecycle and provider-user deletion fence. This must
    // not be replaced by an environment-only switch.
    void admin;
    return Response.json({ error: 'Native Meta synchronization is not released.' }, { status: 503 });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
