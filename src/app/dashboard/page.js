import { getArticles, getDistricts, getQueries, getClients, getExcludedStories, getStoryCorrectionEvents, getSocialSources, getSocialThreads, getSocialMetricSnapshots, getSocialMetricHistory, getRecentSocialReviewEvents, getStrategicProfiles, getStrategicPriorities, getCollectionHealth, getSocialCollectionHealth } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import DashboardClient from './DashboardClient';
import { enrichSocialThreadsWithNativeMetrics, summarizeOwnedSocialAccountMetrics } from '@/lib/socialMetrics.mjs';
import { getAuthenticatedBillingContext } from '@/lib/billing';
import { formatAnnualPriceLabel, INTRODUCTORY_ANNUAL_PRICE_CENTS, resolveCanaryPricing } from '@/lib/pricing';
import { isCanaryPaymentCovered } from '@/lib/payment-status.mjs';
import { redirect } from 'next/navigation';
import { metaIntegrationEnabledForDistrict, metaIntegrationPilotConfigured } from '@/lib/meta-integration.mjs';
import { buildSocialDailySeries } from '@/lib/socialPerformance.mjs';
import { resolveDemoReviewerAccess } from '@/lib/dashboard-access.mjs';
import { loadCanaryAccountAccess } from '@/lib/account-access';
import TrialEnded from './TrialEnded';

const DASHBOARD_DATA_TIMEOUT_MS = 6500;

async function loadDashboardDataset(label, loader, fallback) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label} exceeded the dashboard read budget`);
        error.code = 'DASHBOARD_READ_TIMEOUT';
        reject(error);
      }, DASHBOARD_DATA_TIMEOUT_MS);
    });
    const data = await Promise.race([Promise.resolve().then(loader), timeout]);
    return { data, warning: null };
  } catch (error) {
    console.error('[dashboard-data-read]', {
      label,
      code: error?.code || null,
      message: error?.message || 'Unknown dashboard read error',
    });
    return { data: fallback, warning: label };
  } finally {
    clearTimeout(timer);
  }
}

const DASHBOARD_VIEWS = new Set(['dashboard', 'birdseye', 'social', 'articles', 'queries', 'notes', 'corrections', 'clients', 'settings', 'howto', 'melodi']);
const DEMO_REVIEWER_VIEWS = new Set(['dashboard', 'birdseye', 'social', 'articles', 'howto']);

export default async function DashboardPage({ searchParams }) {
  // Use anon client to identify the current user from their session cookie
  const supabase = await createClient();
  const { data: { user: sessionUser } } = await supabase.auth.getUser();

  // Use admin client to reliably fetch full user metadata
  let userDistrictId = null;
  let isAdmin = false;
  let isDemoReviewer = false;
  let protectedMetadata = {};
  let canManageIntegrations = false;
  let hasExistingMetaConnection = false;
  let adminClient = null;
  let verifiedUser = null;
  if (sessionUser?.id) {
    adminClient = createAdminClient();
    const { data: { user } } = await adminClient.auth.admin.getUserById(sessionUser.id);
    verifiedUser = user;
    protectedMetadata = user?.app_metadata || {};
    userDistrictId = user?.app_metadata?.district_id ?? null;
    isAdmin = user?.app_metadata?.role === 'admin';
    isDemoReviewer = user?.app_metadata?.role === 'demo_reviewer';
    canManageIntegrations = isAdmin || (Array.isArray(protectedMetadata.permissions) && protectedMetadata.permissions.includes('manage_integrations'));
  }

  if (!sessionUser?.id) redirect('/login?redirect_to=/dashboard');
  if (!userDistrictId && !isAdmin && !isDemoReviewer) redirect('/demo?access=pending');

  const accountAccess = await loadCanaryAccountAccess({ user: verifiedUser, admin: adminClient });
  if (!accountAccess.allowed) {
    return (
      <TrialEnded
        districtName={verifiedUser?.user_metadata?.district_name || userDistrictId || 'Canary Data'}
        trialEndsAt={accountAccess.trialEndsAt}
        accessRevoked={accountAccess.reason === 'account_revoked'}
      />
    );
  }
  if (canManageIntegrations) {
    let connectionQuery = adminClient.from('social_provider_connections').select('id').eq('provider', 'meta').limit(1);
    if (!isAdmin && userDistrictId) connectionQuery = connectionQuery.eq('district_id', userDistrictId);
    const { data: existingMetaConnections } = await connectionQuery;
    hasExistingMetaConnection = Boolean(existingMetaConnections?.length);
  }

  const districtLoad = await loadDashboardDataset('District list', getDistricts, []);
  const allDistricts = districtLoad.data;
  const requested = await searchParams;
  const requestedDistrictId = String(requested?.district || '');
  const requestedView = String(requested?.view || 'dashboard');
  const reviewerAccess = resolveDemoReviewerAccess({
    metadata: protectedMetadata,
    districts: allDistricts,
    requestedDistrictId,
  });
  if (isDemoReviewer && !reviewerAccess.hasAccess) redirect('/demo?access=pending');
  const districts = isDemoReviewer ? reviewerAccess.districts : allDistricts;
  const initialView = (isDemoReviewer ? DEMO_REVIEWER_VIEWS : DASHBOARD_VIEWS).has(requestedView) ? requestedView : 'dashboard';
  if (isDemoReviewer && requestedDistrictId !== reviewerAccess.selectedDistrictId) {
    redirect(`/dashboard?district=${encodeURIComponent(reviewerAccess.selectedDistrictId)}&view=${encodeURIComponent(initialView)}`);
  }
  if (isAdmin && !requestedDistrictId && districts[0]?.id) {
    redirect(`/dashboard?district=${encodeURIComponent(districts[0].id)}&view=${encodeURIComponent(initialView)}`);
  }
  const validRequestedDistrictId = districts.some((district) => district.id === requestedDistrictId)
    ? requestedDistrictId
    : null;
  const initialDistrictId = isDemoReviewer
    ? reviewerAccess.selectedDistrictId
    : userDistrictId
    || (requestedDistrictId === 'All' ? 'All' : validRequestedDistrictId || districts[0]?.id || 'All');
  const dataDistrictId = isDemoReviewer
    ? reviewerAccess.selectedDistrictId
    : userDistrictId || (initialDistrictId === 'All' ? null : initialDistrictId);
  const dashboardUserDistrictId = isDemoReviewer ? null : userDistrictId;
  const dataLoads = await Promise.all([
    loadDashboardDataset('News results', () => getArticles(dataDistrictId), []),
    loadDashboardDataset('Queries', () => getQueries(dataDistrictId), []),
    isAdmin ? loadDashboardDataset('Client directory', getClients, []) : Promise.resolve({ data: [], warning: null }),
    loadDashboardDataset('Excluded news results', () => getExcludedStories(dataDistrictId), []),
    loadDashboardDataset('News correction history', () => getStoryCorrectionEvents(dataDistrictId), []),
    loadDashboardDataset('Social sources', () => getSocialSources(dataDistrictId), []),
    loadDashboardDataset('Social results', () => getSocialThreads(dataDistrictId, isAdmin), []),
    loadDashboardDataset('Native Social metrics', () => getSocialMetricSnapshots(dataDistrictId), []),
    dataDistrictId ? loadDashboardDataset('Native Social history', () => getSocialMetricHistory(dataDistrictId), []) : Promise.resolve({ data: [], warning: null }),
    isAdmin ? loadDashboardDataset('Social correction history', () => getRecentSocialReviewEvents(dataDistrictId), []) : Promise.resolve({ data: [], warning: null }),
    loadDashboardDataset('Strategic profiles', () => getStrategicProfiles(dataDistrictId), []),
    loadDashboardDataset('Strategic priorities', () => getStrategicPriorities(dataDistrictId), []),
    loadDashboardDataset('Collection health', () => getCollectionHealth(districts, dataDistrictId), []),
    loadDashboardDataset('Social collection health', () => getSocialCollectionHealth(districts, dataDistrictId), []),
  ]);
  const [articles, queries, clients, excludedStories, correctionEvents, socialSources, socialThreads, socialMetricSnapshots, socialMetricHistory, socialReviewEvents, strategicProfiles, strategicPriorities, collectionHealth, socialCollectionHealth] = dataLoads.map((result) => result.data);
  const enrichedSocialThreads = enrichSocialThreadsWithNativeMetrics(socialThreads, socialMetricSnapshots);
  const socialAccountMetricSummaries = Object.fromEntries(
    [...new Set(socialMetricSnapshots.map((row) => row.district_id).filter(Boolean))].map((districtId) => [
      districtId,
      summarizeOwnedSocialAccountMetrics(socialMetricSnapshots.filter((row) => row.district_id === districtId)),
    ]),
  );
  const socialPerformanceHistory = dataDistrictId
    ? { [dataDistrictId]: buildSocialDailySeries(socialMetricHistory.filter((row) => row.district_id === dataDistrictId)) }
    : {};
  const billingLoad = dashboardUserDistrictId
    ? await loadDashboardDataset('Billing status', getAuthenticatedBillingContext, null)
    : { data: null, warning: null };
  const billingContext = billingLoad.data;
  const dataWarnings = [districtLoad, ...dataLoads, billingLoad]
    .map((result) => result.warning)
    .filter(Boolean);
  const trialEndsAt = billingContext?.onboardingRequest?.trial_ends_at || billingContext?.user?.app_metadata?.trial_ends_at || null;
  const paymentStatus = billingContext?.onboardingRequest?.payment_status || billingContext?.user?.app_metadata?.payment_status || 'pending';
  const paidThrough = billingContext?.user?.app_metadata?.paid_through || billingContext?.onboardingRequest?.paid_through || null;
  // eslint-disable-next-line react-hooks/purity -- Server-rendered billing notice intentionally compares trial date to current time.
  const daysUntilTrialEnds = trialEndsAt ? Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000) : null;
  const paymentNotice = dashboardUserDistrictId && !isCanaryPaymentCovered(paymentStatus, paidThrough) && daysUntilTrialEnds !== null
    ? {
        daysUntilTrialEnds,
        trialEndsAt,
        paymentStatus,
      }
    : null;
  const billingInfo = billingContext ? {
    paymentStatus,
    trialStartsAt: billingContext.onboardingRequest?.trial_starts_at || billingContext.user?.app_metadata?.trial_starts_at || null,
    trialEndsAt,
    paidThrough,
    billingOrganizationName: billingContext.user?.user_metadata?.billing_organization_name || billingContext.districtName || billingContext.onboardingRequest?.organization_name || billingContext.user?.user_metadata?.district_name || '',
    poNumber: billingContext.user?.user_metadata?.po_number || '',
    billingContactName: billingContext.user?.user_metadata?.billing_contact_name || '',
    billingPhone: billingContext.user?.user_metadata?.billing_phone || '',
    billingAddressLine1: billingContext.user?.user_metadata?.billing_address_line1 || '',
    billingAddressLine2: billingContext.user?.user_metadata?.billing_address_line2 || '',
    billingCity: billingContext.user?.user_metadata?.billing_city || '',
    billingState: billingContext.user?.user_metadata?.billing_state || '',
    billingZip: billingContext.user?.user_metadata?.billing_zip || '',
    amountCents: billingContext.pricing?.amountCents || null,
    amountLabel: billingContext.pricing ? formatAnnualPriceLabel(billingContext.pricing.amountCents) : '',
    pricingReason: billingContext.pricing?.reason || '',
    pricingLocked: Boolean(billingContext.pricing?.locked),
  } : null;
  const publicPricing = resolveCanaryPricing();

  return (
    <DashboardClient
      articles={articles}
      districts={districts}
      queries={queries}
      clients={clients}
      userDistrictId={dashboardUserDistrictId}
      initialDistrictId={initialDistrictId}
      initialView={initialView}
      paymentNotice={paymentNotice}
      billingInfo={billingInfo}
      publicPricingLabel={formatAnnualPriceLabel(publicPricing.amountCents)}
      publicPricingIntroductory={publicPricing.amountCents === INTRODUCTORY_ANNUAL_PRICE_CENTS}
      excludedStories={excludedStories}
      correctionEvents={correctionEvents}
      socialSources={socialSources}
      socialThreads={enrichedSocialThreads}
      socialAccountMetricSummaries={socialAccountMetricSummaries}
      socialPerformanceHistory={socialPerformanceHistory}
      socialReviewEvents={socialReviewEvents}
      isAdmin={isAdmin}
      isDemoReviewer={isDemoReviewer}
      reviewerDistrictCount={reviewerAccess.districtIds.length}
      strategicProfiles={strategicProfiles}
      strategicPriorities={strategicPriorities}
      collectionHealth={collectionHealth}
      socialCollectionHealth={socialCollectionHealth}
      dataWarnings={dataWarnings}
      melodiEnabled={!isDemoReviewer && process.env.MELODI_ENABLED === 'true' && (process.env.MELODI_QA_MODE !== 'true' || isAdmin)}
      metaIntegrationEnabled={canManageIntegrations && (hasExistingMetaConnection || (isAdmin ? metaIntegrationPilotConfigured() : metaIntegrationEnabledForDistrict(userDistrictId)))}
    />
  );
}
