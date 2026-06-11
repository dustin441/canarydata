import DashboardClient from '@/app/dashboard/DashboardClient';
import { demoArticles, demoDistricts, demoQueries } from '@/lib/demo-data';

export const metadata = {
  title: 'Canary Data Demo Dashboard | Central High School Phoenix',
  description: 'Interactive Canary Data demo dashboard with sample public-media intelligence for Central High School in Phoenix, Arizona.',
};

export default function DemoDashboardPage() {
  return (
    <DashboardClient
      articles={demoArticles}
      districts={demoDistricts}
      queries={demoQueries}
      clients={[]}
      userDistrictId="phoenix-central-high"
      demoMode
    />
  );
}
