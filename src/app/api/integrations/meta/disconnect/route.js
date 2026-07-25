import { requireIntegrationActor, integrationErrorResponse } from '@/lib/integration-auth';
import { decryptMetaToken, revokeMetaPermissions } from '@/lib/meta-integration.mjs';

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

    const { data: credential, error: credentialLookupError } = await admin
      .from('social_provider_credentials')
      .select('encrypted_access_token,key_version')
      .eq('connection_id', connection.id)
      .eq('district_id', actor.districtId)
      .maybeSingle();
    if (credentialLookupError) throw credentialLookupError;

    let revokeWarning = false;
    if (credential?.encrypted_access_token && connection.status !== 'revoked') {
      try {
        if (credential.key_version !== 1) throw new Error('Unsupported Meta credential key version.');
        const tokenContext = `${connection.id}:${actor.districtId}:meta`;
        await revokeMetaPermissions(decryptMetaToken(credential.encrypted_access_token, tokenContext));
      } catch (revokeError) {
        revokeWarning = true;
        console.warn('Meta permission revocation could not be confirmed', { code: revokeError?.code || 'unknown' });
      }
    }

    const { data: disconnected, error: disconnectError } = await admin.rpc('canary_disconnect_meta_connection', {
      p_connection_id: connection.id,
      p_district_id: actor.districtId,
      p_revocation_unconfirmed: revokeWarning,
    });
    if (disconnectError) throw disconnectError;
    if (disconnected !== true) throw new Error('Meta connection could not be disconnected.');

    return Response.json({ ok: true, remoteRevocationConfirmed: !revokeWarning });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
