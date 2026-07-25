import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function requireIntegrationActor(requestedDistrictId = null) {
  const sessionClient = await createServerClient();
  const { data: { user: sessionUser } } = await sessionClient.auth.getUser();
  if (!sessionUser?.id) {
    const error = new Error('Authentication required.');
    error.status = 401;
    throw error;
  }

  const admin = createAdminClient();
  const { data: { user }, error: userError } = await admin.auth.admin.getUserById(sessionUser.id);
  if (userError || !user) {
    const error = new Error('Canary account could not be verified.');
    error.status = 401;
    throw error;
  }

  const appMetadata = user.app_metadata || {};
  const isAdmin = appMetadata.role === 'admin';
  const permissions = Array.isArray(appMetadata.permissions) ? appMetadata.permissions : [];
  const canManageIntegrations = isAdmin || permissions.includes('manage_integrations');
  const assignedDistrictId = appMetadata.district_id || null;
  const districtId = isAdmin ? requestedDistrictId : assignedDistrictId;

  if (!canManageIntegrations) {
    const error = new Error('This account cannot manage integrations.');
    error.status = 403;
    throw error;
  }
  if (!districtId) {
    const error = new Error(isAdmin ? 'Choose a district before connecting Meta.' : 'District access is not configured.');
    error.status = 403;
    throw error;
  }
  if (!isAdmin && requestedDistrictId && requestedDistrictId !== assignedDistrictId) {
    const error = new Error('Cross-district integration access is not allowed.');
    error.status = 403;
    throw error;
  }
  if (isAdmin && requestedDistrictId) {
    const { data: district, error: districtError } = await admin.from('districts').select('id').eq('id', districtId).maybeSingle();
    if (districtError || !district) {
      const error = new Error('The selected district does not exist.');
      error.status = 404;
      throw error;
    }
  }

  return {
    actor: { id: user.id, districtId, assignedDistrictId, isAdmin, canManageIntegrations },
    admin,
  };
}

export function integrationErrorResponse(error) {
  const status = Number(error?.status) || 500;
  const message = status >= 500 ? 'The integration request could not be completed.' : error.message;
  return Response.json({ error: message }, { status });
}
