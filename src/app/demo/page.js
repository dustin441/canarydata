import DashboardClient from '@/app/dashboard/DashboardClient';
import { demoArticles, demoDistricts, demoQueries, demoSocialSources } from '@/lib/demo-data';
import { buildDemoSocialData } from '@/lib/demo-social-data.mjs';
import { isNewsMediaArticle } from '@/lib/reportingDataset.mjs';
import { formatAnnualPriceLabel, INTRODUCTORY_ANNUAL_PRICE_CENTS, resolveCanaryPricing } from '@/lib/pricing';

export const metadata = {
  title: 'Canary Data Demo Dashboard | Canary Falls Unified School District',
  description: 'Interactive Canary Data demo dashboard showing strategic communications intelligence, Bird’s Eye View reporting, and leadership-ready district-priority evidence for Canary Falls Unified School District.',
};

// Demo Social fixtures use request-relative dates so the account always feels current.
export const dynamic = 'force-dynamic';

export default function DemoPage() {
  const socialDemo = buildDemoSocialData();
  const publicPricing = resolveCanaryPricing();
  return (
    <DashboardClient
      articles={demoArticles.filter(isNewsMediaArticle)}
      districts={demoDistricts}
      queries={demoQueries}
      clients={[]}
      socialSources={demoSocialSources}
      socialThreads={socialDemo.socialThreads}
      socialAccountMetricSummaries={socialDemo.socialAccountMetricSummaries}
      socialPerformanceHistory={socialDemo.socialPerformanceHistory}
      socialReportAsOf={socialDemo.reportAsOf}
      publicPricingLabel={formatAnnualPriceLabel(publicPricing.amountCents)}
      publicPricingIntroductory={publicPricing.amountCents === INTRODUCTORY_ANNUAL_PRICE_CENTS}
      userDistrictId="canary-falls-usd"
      demoMode
    />
  );
}
