import { getArticles, getDistricts } from '@/lib/data';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const [articles, districts] = await Promise.all([getArticles(), getDistricts()]);
  return <DashboardClient articles={articles} districts={districts} />;
}
