import { getArticles, getDistricts, getQueries, getClients } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import DashboardClient from './DashboardClient';
import { getAuthenticatedBillingContext } from '@/lib/billing';

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

  const [articles, districts, queries, clients] = await Promise.all([
    getArticles(userDistrictId),
    getDistricts(),
    getQueries(userDistrictId),
    userDistrictId ? Promise.resolve([]) : getClients(),
  ]);

  const billingContext = userDistrictId ? await getAuthenticatedBillingContext() : null;
  const trialEndsAt = billingContext?.onboardingRequest?.trial_ends_at || billingContext?.user?.user_metadata?.trial_ends_at || null;
  // eslint-disable-next-line react-hooks/purity -- Server-rendered billing notice intentionally compares trial date to current time.
  const daysUntilTrialEnds = trialEndsAt ? Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000) : null;
  const paymentNotice = userDistrictId && billingContext?.onboardingRequest?.payment_status !== 'paid' && daysUntilTrialEnds !== null && daysUntilTrialEnds <= 7
    ? {
        daysUntilTrialEnds,
        trialEndsAt,
        paymentStatus: billingContext?.onboardingRequest?.payment_status || 'pending',
      }
    : null;
  const billingInfo = billingContext ? {
    paymentStatus: billingContext.onboardingRequest?.payment_status || billingContext.user?.user_metadata?.payment_status || 'pending',
    trialStartsAt: billingContext.onboardingRequest?.trial_starts_at || billingContext.user?.user_metadata?.trial_starts_at || null,
    trialEndsAt,
    paidThrough: billingContext.user?.user_metadata?.paid_through || billingContext.onboardingRequest?.paid_through || null,
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
    />
  );
}
