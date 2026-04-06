import { getArticles, getDistricts } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // If user has a district_id in their metadata, lock them to that district
  const userDistrictId = user?.user_metadata?.district_id ?? null;

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
