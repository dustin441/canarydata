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
  const trialEndsAt = billingContext?.onboardingRequest?.trial_ends_at || null;
  // eslint-disable-next-line react-hooks/purity -- Server-rendered billing notice intentionally compares trial date to current time.
  const daysUntilTrialEnds = trialEndsAt ? Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000) : null;
  const paymentNotice = userDistrictId && billingContext?.onboardingRequest?.payment_status !== 'paid' && daysUntilTrialEnds !== null && daysUntilTrialEnds <= 7
    ? {
        daysUntilTrialEnds,
        trialEndsAt,
        paymentStatus: billingContext?.onboardingRequest?.payment_status || 'pending',
      }
    : null;

  return (
    <DashboardClient
      articles={articles}
      districts={districts}
      queries={queries}
      clients={clients}
      userDistrictId={userDistrictId}
      paymentNotice={paymentNotice}
    />
  );
}
