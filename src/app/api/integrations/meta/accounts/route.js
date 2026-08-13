import { requireIntegrationActor, integrationErrorResponse } from '@/lib/integration-auth';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { actor, admin } = await requireIntegrationActor(body?.districtId || null);
    const selections = Array.isArray(body?.accounts) ? body.accounts : [];
    if (selections.length > 250) return Response.json({ error: 'Too many accounts were selected.' }, { status: 400 });

    const selectedIds = [...new Set(selections.filter((item) => item?.selected).map((item) => String(item.id || '')))];
    if (selectedIds.some((id) => !UUID_PATTERN.test(id))) {
      return Response.json({ error: 'An invalid account selection was provided.' }, { status: 400 });
    }

    const { data: district, error: districtError } = await admin
      .from('districts')
      .select('name')
      .eq('id', actor.districtId)
      .single();
    if (districtError) throw districtError;

    const { data: selectedCount, error: mappingError } = await admin.rpc('canary_replace_meta_asset_mappings', {
      p_district_id: actor.districtId,
      p_asset_ids: selectedIds,
      p_mapped_by: actor.id,
      p_scope_label: district?.name || 'District',
    });
    if (mappingError) {
      if (String(mappingError.message || '').includes('do not belong')) {
        return Response.json({ error: 'One or more accounts are outside the authorized district.' }, { status: 403 });
      }
      throw mappingError;
    }

    if (process.env.META_NATIVE_SYNC_ENABLED === 'true') {
      const { data: connection, error: connectionError } = await admin
        .from('social_provider_connections')
        .select('id')
        .eq('district_id', actor.districtId)
        .eq('provider', 'meta')
        .in('status', ['active', 'needs_permissions'])
        .maybeSingle();
      if (connectionError) throw connectionError;
      if (!connection) throw new Error('An active Meta connection is required before linking selected assets.');
      const { error: linkError } = await admin.rpc('canary_link_selected_meta_assets', {
        p_district_id: actor.districtId,
        p_connection_id: connection.id,
      });
      if (linkError) throw linkError;
    }

    return Response.json({ ok: true, selectedCount: Number(selectedCount) || 0 });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
