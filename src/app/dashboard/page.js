import { getArticles, getDistricts, getQueries, getClients, getExcludedStories, getStoryCorrectionEvents, getSocialSources, getSocialThreads, getRecentSocialReviewEvents, getStrategicProfiles, getStrategicPriorities, getCollectionHealth, getSocialCollectionHealth } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import DashboardClient from './DashboardClient';
import { getAuthenticatedBillingContext } from '@/lib/billing';
import { redirect } from 'next/navigation';

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

const DASHBOARD_VIEWS = new Set(['dashboard', 'birdseye', 'social', 'queries', 'notes', 'corrections', 'clients', 'settings', 'howto', 'melodi']);

export default async function DashboardPage({ searchParams }) {
  // Use anon client to identify the current user from their session cookie
  const supabase = await createClient();
  const { data: { user: sessionUser } } = await supabase.auth.getUser();

  // Use admin client to reliably fetch full user metadata
  let userDistrictId = null;
  let isAdmin = false;
  let canManageIntegrations = false;
  if (sessionUser?.id) {
    const admin = createAdminClient();
    const { data: { user } } = await admin.auth.admin.getUserById(sessionUser.id);
    userDistrictId = user?.app_metadata?.district_id ?? null;
    isAdmin = user?.app_metadata?.role === 'admin';
    canManageIntegrations = isAdmin || (Array.isArray(user?.app_metadata?.permissions) && user.app_metadata.permissions.includes('manage_integrations'));
  }

  if (!sessionUser?.id) redirect('/login?redirect_to=/dashboard');
  if (!userDistrictId && !isAdmin) redirect('/demo?access=pending');

  const districtLoad = await loadDashboardDataset('District list', getDistricts, []);
  const districts = districtLoad.data;
  const requested = await searchParams;
  const requestedDistrictId = String(requested?.district || '');
  const requestedView = String(requested?.view || 'dashboard');
  const initialView = DASHBOARD_VIEWS.has(requestedView) ? requestedView : 'dashboard';
  if (isAdmin && !requestedDistrictId && districts[0]?.id) {
    redirect(`/dashboard?district=${encodeURIComponent(districts[0].id)}&view=${encodeURIComponent(initialView)}`);
  }
  const validRequestedDistrictId = districts.some((district) => district.id === requestedDistrictId)
    ? requestedDistrictId
    : null;
  const initialDistrictId = userDistrictId
    || (requestedDistrictId === 'All' ? 'All' : validRequestedDistrictId || districts[0]?.id || 'All');
  const dataDistrictId = userDistrictId || (initialDistrictId === 'All' ? null : initialDistrictId);
  const dataLoads = await Promise.all([
    loadDashboardDataset('News results', () => getArticles(dataDistrictId), []),
    loadDashboardDataset('Queries', () => getQueries(dataDistrictId), []),
    isAdmin ? loadDashboardDataset('Client directory', getClients, []) : Promise.resolve({ data: [], warning: null }),
    loadDashboardDataset('Excluded news results', () => getExcludedStories(dataDistrictId), []),
    loadDashboardDataset('News correction history', () => getStoryCorrectionEvents(dataDistrictId), []),
    loadDashboardDataset('Social sources', () => getSocialSources(dataDistrictId), []),
    loadDashboardDataset('Social results', () => getSocialThreads(dataDistrictId, isAdmin), []),
    isAdmin ? loadDashboardDataset('Social correction history', () => getRecentSocialReviewEvents(dataDistrictId), []) : Promise.resolve({ data: [], warning: null }),
    loadDashboardDataset('Strategic profiles', () => getStrategicProfiles(dataDistrictId), []),
    loadDashboardDataset('Strategic priorities', () => getStrategicPriorities(dataDistrictId), []),
    loadDashboardDataset('Collection health', () => getCollectionHealth(districts, dataDistrictId), []),
    loadDashboardDataset('Social collection health', () => getSocialCollectionHealth(districts, dataDistrictId), []),
  ]);
  const [articles, queries, clients, excludedStories, correctionEvents, socialSources, socialThreads, socialReviewEvents, strategicProfiles, strategicPriorities, collectionHealth, socialCollectionHealth] = dataLoads.map((result) => result.data);
  const billingLoad = userDistrictId
    ? await loadDashboardDataset('Billing status', getAuthenticatedBillingContext, null)
    : { data: null, warning: null };
  const billingContext = billingLoad.data;
  const dataWarnings = [districtLoad, ...dataLoads, billingLoad]
    .map((result) => result.warning)
    .filter(Boolean);
  const trialEndsAt = billingContext?.onboardingRequest?.trial_ends_at || billingContext?.user?.app_metadata?.trial_ends_at || null;
  // eslint-disable-next-line react-hooks/purity -- Server-rendered billing notice intentionally compares trial date to current time.
  const daysUntilTrialEnds = trialEndsAt ? Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000) : null;
  const paymentNotice = userDistrictId && billingContext?.onboardingRequest?.payment_status !== 'paid' && daysUntilTrialEnds !== null
    ? {
        daysUntilTrialEnds,
        trialEndsAt,
        paymentStatus: billingContext?.onboardingRequest?.payment_status || 'pending',
      }
    : null;
  const billingInfo = billingContext ? {
    paymentStatus: billingContext.onboardingRequest?.payment_status || billingContext.user?.app_metadata?.payment_status || 'pending',
    trialStartsAt: billingContext.onboardingRequest?.trial_starts_at || billingContext.user?.app_metadata?.trial_starts_at || null,
    trialEndsAt,
    paidThrough: billingContext.user?.app_metadata?.paid_through || billingContext.onboardingRequest?.paid_through || null,
    billingOrganizationName: billingContext.user?.user_metadata?.billing_organization_name || billingContext.districtName || billingContext.onboardingRequest?.organization_name || billingContext.user?.user_metadata?.district_name || '',
    poNumber: billingContext.user?.user_metadata?.po_number || '',
    billingContactName: billingContext.user?.user_metadata?.billing_contact_name || '',
    billingPhone: billingContext.user?.user_metadata?.billing_phone || '',
    billingAddressLine1: billingContext.user?.user_metadata?.billing_address_line1 || '',
    billingAddressLine2: billingContext.user?.user_metadata?.billing_address_line2 || '',
    billingCity: billingContext.user?.user_metadata?.billing_city || '',
    billingState: billingContext.user?.user_metadata?.billing_state || '',
    billingZip: billingContext.user?.user_metadata?.billing_zip || '',
  } : null;

  return (
    <DashboardClient
      articles={articles}
      districts={districts}
      queries={queries}
      clients={clients}
      userDistrictId={userDistrictId}
      initialDistrictId={initialDistrictId}
      initialView={initialView}
      paymentNotice={paymentNotice}
      billingInfo={billingInfo}
      excludedStories={excludedStories}
      correctionEvents={correctionEvents}
      socialSources={socialSources}
      socialThreads={socialThreads}
      socialReviewEvents={socialReviewEvents}
      isAdmin={isAdmin}
      strategicProfiles={strategicProfiles}
      strategicPriorities={strategicPriorities}
      collectionHealth={collectionHealth}
      socialCollectionHealth={socialCollectionHealth}
      dataWarnings={dataWarnings}
      melodiEnabled={process.env.MELODI_ENABLED === 'true' && (process.env.MELODI_QA_MODE !== 'true' || isAdmin)}
      metaIntegrationEnabled={canManageIntegrations && process.env.META_INTEGRATION_ENABLED === 'true' && Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_TOKEN_ENCRYPTION_KEY && process.env.META_REDIRECT_URI)}
    />
  );
}
