import DashboardClient from '@/app/dashboard/DashboardClient';
import { demoArticles, demoDistricts, demoQueries } from '@/lib/demo-data';

export const metadata = {
  title: 'Canary Data Demo Dashboard | Canary Falls Unified School District',
  description: 'Interactive Canary Data demo dashboard showing strategic communications intelligence, Bird’s Eye View reporting, and leadership-ready district-priority evidence for Canary Falls Unified School District.',
};

export default function DemoDashboardPage() {
  return (
    <DashboardClient
      articles={demoArticles}
      districts={demoDistricts}
      queries={demoQueries}
      clients={[]}
      userDistrictId="canary-falls-usd"
      demoMode
    />
  );
}
