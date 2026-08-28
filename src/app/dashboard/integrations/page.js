import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDistricts } from '@/lib/data';
import MetaIntegrationClient from './MetaIntegrationClient';
import { loadCanaryAccountAccess } from '@/lib/account-access';

export default async function IntegrationsPage({ searchParams }) {
  const params = await searchParams;
  const sessionClient = await createClient();
  const { data: { user: sessionUser } } = await sessionClient.auth.getUser();
  if (!sessionUser?.id) redirect('/login?redirect_to=/dashboard/integrations');

  const admin = createAdminClient();
  const { data: { user } } = await admin.auth.admin.getUserById(sessionUser.id);
  const isAdmin = user?.app_metadata?.role === 'admin';
  const access = await loadCanaryAccountAccess({ user, admin });
  if (!access.allowed) redirect('/dashboard');
  const permissions = Array.isArray(user?.app_metadata?.permissions) ? user.app_metadata.permissions : [];
  if (!isAdmin && !permissions.includes('manage_integrations')) redirect('/dashboard');
  const assignedDistrictId = user?.app_metadata?.district_id || null;
  const districts = await getDistricts();
  const requestedDistrictId = typeof params?.districtId === 'string' ? params.districtId : null;
  const districtId = isAdmin
    ? (requestedDistrictId && districts.some((district) => district.id === requestedDistrictId) ? requestedDistrictId : null)
    : assignedDistrictId;
  if (!isAdmin && !districtId) redirect('/demo?access=pending');
  const district = districts.find((item) => item.id === districtId);

  return (
    <MetaIntegrationClient
      districtId={districtId}
      districtName={district?.name || 'Selected district'}
      districts={isAdmin ? districts : []}
      isAdmin={isAdmin}
      oauthStatus={typeof params?.meta === 'string' ? params.meta : ''}
    />
  );
}
