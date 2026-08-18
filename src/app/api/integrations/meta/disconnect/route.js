import { requireIntegrationActor, integrationErrorResponse } from '@/lib/integration-auth';

export const runtime = 'nodejs';

export async function DELETE(request) {
  try {
    const body = await request.json();
    const { actor, admin } = await requireIntegrationActor(body?.districtId || null);
    const connectionId = String(body?.connectionId || '');
    if (!connectionId) return Response.json({ error: 'A connection is required.' }, { status: 400 });

    const { data: connection, error } = await admin
      .from('social_provider_connections')
      .select('id,status')
      .eq('id', connectionId)
      .eq('district_id', actor.districtId)
      .eq('provider', 'meta')
      .maybeSingle();
    if (error) throw error;
    if (!connection) return Response.json({ error: 'Meta connection not found.' }, { status: 404 });

    const { data: disconnected, error: disconnectError } = await admin.rpc('canary_disconnect_meta_connection', {
      p_connection_id: connection.id,
      p_district_id: actor.districtId,
      p_revocation_unconfirmed: false,
    });
    if (disconnectError) throw disconnectError;
    if (disconnected !== true) throw new Error('Meta connection could not be disconnected.');

    // Meta's DELETE /me/permissions is app/user-wide, not district-scoped.
    // Ordinary disconnect is deliberately local-only so one district cannot
    // revoke another district's healthy grant or a concurrent reconnect.
    return Response.json({ ok: true, remoteRevocationConfirmed: false, disconnectScope: 'district_local' });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
