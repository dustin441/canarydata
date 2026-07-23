import { getArticles, getDistricts, getQueries, getClients, getExcludedStories, getStoryCorrectionEvents, getSocialSources, getSocialThreads, getStrategicProfiles, getStrategicPriorities } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import DashboardClient from './DashboardClient';
import { getAuthenticatedBillingContext } from '@/lib/billing';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  // Use anon client to identify the current user from their session cookie
  const supabase = await createClient();
  const { data: { user: sessionUser } } = await supabase.auth.getUser();

  // Use admin client to reliably fetch full user metadata
  let userDistrictId = null;
  let isAdmin = false;
  if (sessionUser?.id) {
    const admin = createAdminClient();
    const { data: { user } } = await admin.auth.admin.getUserById(sessionUser.id);
    userDistrictId = user?.app_metadata?.district_id ?? null;
    isAdmin = user?.app_metadata?.role === 'admin';
  }

  if (!sessionUser?.id) redirect('/login?redirect_to=/dashboard');
  if (!userDistrictId && !isAdmin) redirect('/demo?access=pending');

  const [articles, districts, queries, clients, excludedStories, correctionEvents, socialSources, socialThreads, strategicProfiles, strategicPriorities] = await Promise.all([
    getArticles(userDistrictId),
    getDistricts(),
    getQueries(userDistrictId),
    isAdmin ? getClients() : Promise.resolve([]),
    getExcludedStories(userDistrictId),
    getStoryCorrectionEvents(userDistrictId),
    getSocialSources(userDistrictId),
    getSocialThreads(userDistrictId, isAdmin),
    getStrategicProfiles(userDistrictId),
    getStrategicPriorities(userDistrictId),
  ]);

  const billingContext = userDistrictId ? await getAuthenticatedBillingContext() : null;
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
      paymentNotice={paymentNotice}
      billingInfo={billingInfo}
      excludedStories={excludedStories}
      correctionEvents={correctionEvents}
      socialSources={socialSources}
      socialThreads={socialThreads}
      strategicProfiles={strategicProfiles}
      strategicPriorities={strategicPriorities}
      melodiEnabled={process.env.MELODI_ENABLED === 'true'}
    />
  );
}
