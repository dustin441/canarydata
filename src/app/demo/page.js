import DashboardClient from '@/app/dashboard/DashboardClient';
import { demoArticles, demoDistricts, demoQueries } from '@/lib/demo-data';

export const metadata = {
  title: 'Canary Data Demo Dashboard | Sample City School District',
  description: 'Interactive Canary Data demo dashboard with generic sample public-media intelligence for Sample City School District.',
};

export default function DemoDashboardPage() {
  return (
    <DashboardClient
      articles={demoArticles}
      districts={demoDistricts}
      queries={demoQueries}
      clients={[]}
      userDistrictId="sample-city-usd"
      demoMode
    />
  );
}
