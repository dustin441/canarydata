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

    let accessToken = null;
    let revokeWarning = connection.status !== 'revoked' && !credential?.encrypted_access_token;
    if (revokeWarning) {
      console.warn('Meta credential is unavailable for remote revocation', { code: 'credential_missing' });
    }
    if (credential?.encrypted_access_token && connection.status !== 'revoked') {
      try {
        if (credential.key_version !== 1) throw new Error('Unsupported Meta credential key version.');
        accessToken = decryptMetaToken(credential.encrypted_access_token, `${connection.id}:${actor.districtId}:meta`);
      } catch (tokenError) {
        revokeWarning = true;
        console.warn('Meta credential could not be recovered for remote revocation', { code: tokenError?.code || 'credential_unavailable' });
      }
    }
    const { data: disconnected, error: disconnectError } = await admin.rpc('canary_disconnect_meta_connection', {
      p_connection_id: connection.id,
      p_district_id: actor.districtId,
      p_revocation_unconfirmed: revokeWarning,
    });
    if (disconnectError) throw disconnectError;
    if (disconnected !== true) throw new Error('Meta connection could not be disconnected.');

    if (accessToken) {
      try {
        await revokeMetaPermissions(accessToken);
      } catch (revokeError) {
        revokeWarning = true;
        console.warn('Meta permission revocation could not be confirmed', { code: revokeError?.code || 'unknown' });
        const { error: warningError } = await admin.from('social_provider_connections').update({
          last_error_code: 'remote_revocation_unconfirmed',
          last_error_message: 'Local access was removed, but Meta revocation could not be confirmed.',
        }).eq('id', connection.id).eq('district_id', actor.districtId).eq('provider', 'meta').eq('status', 'revoked');
        if (warningError) throw warningError;
      }
    }

    return Response.json({ ok: true, remoteRevocationConfirmed: !revokeWarning });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
