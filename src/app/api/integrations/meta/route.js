import { requireIntegrationActor, integrationErrorResponse } from '@/lib/integration-auth';
import { metaConfigured } from '@/lib/meta-integration.mjs';

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const { actor, admin } = await requireIntegrationActor(url.searchParams.get('districtId'));
    const configured = metaConfigured() && process.env.META_INTEGRATION_ENABLED === 'true';
    if (!configured) {
      return Response.json({ configured: false, districtId: actor.districtId, connections: [], accounts: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const { data: connections, error: connectionError } = await admin
      .from('social_provider_connections')
      .select('id,provider_user_name,status,token_expires_at,granted_scopes,declined_scopes,connected_at,last_validated_at,last_error_code,revoked_at')
      .eq('district_id', actor.districtId)
      .eq('provider', 'meta')
      .order('updated_at', { ascending: false });
    if (connectionError) throw connectionError;

    const connectionIds = (connections || []).map((connection) => connection.id);
    let accounts = [];
    if (connectionIds.length) {
      const { data: assets, error: assetError } = await admin
        .from('social_provider_assets')
        .select('id,connection_id,provider_asset_id,asset_type,platform,name,handle,profile_url,parent_provider_asset_id,selected,active,metadata,discovered_at,last_seen_at')
        .eq('district_id', actor.districtId)
        .in('connection_id', connectionIds)
        .eq('active', true)
        .order('asset_type', { ascending: true })
        .order('name', { ascending: true });
      if (assetError) throw assetError;
      const assetIds = (assets || []).map((asset) => asset.id);
      let mappings = [];
      if (assetIds.length) {
        const { data, error: mappingError } = await admin
          .from('social_account_mappings')
          .select('provider_asset_id,scope_type,scope_label,reporting_enabled')
          .eq('district_id', actor.districtId)
          .in('provider_asset_id', assetIds);
        if (mappingError) throw mappingError;
        mappings = data || [];
      }
      const mappingByAsset = new Map(mappings.map((mapping) => [mapping.provider_asset_id, mapping]));
      accounts = (assets || []).map((asset) => ({ ...asset, ...(mappingByAsset.get(asset.id) || {}) }));
    }

    return Response.json({
      configured,
      districtId: actor.districtId,
      connections: connections || [],
      accounts,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
