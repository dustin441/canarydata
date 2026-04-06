import { getArticles, getDistricts } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  // Use anon client to identify the current user from their session cookie
  const supabase = await createClient();
  const { data: { user: sessionUser } } = await supabase.auth.getUser();

  // Use admin client to reliably fetch full user metadata
  let userDistrictId = null;
  if (sessionUser?.id) {
    const admin = createAdminClient();
    const { data: { user } } = await admin.auth.admin.getUserById(sessionUser.id);
    userDistrictId = user?.user_metadata?.district_id ?? null;
  }

  const [articles, districts] = await Promise.all([
    getArticles(userDistrictId),
    getDistricts(),
  ]);

  return (
    <DashboardClient
      articles={articles}
      districts={districts}
      userDistrictId={userDistrictId}
    />
  );
}
