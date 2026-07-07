import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function getAuthenticatedBillingContext() {
  const supabase = await createClient();
  const { data: { user: sessionUser } } = await supabase.auth.getUser();
  if (!sessionUser?.id) return { user: null, districtId: null, districtName: null, email: null, onboardingRequest: null };

  const admin = createAdminClient();
  const { data: { user } } = await admin.auth.admin.getUserById(sessionUser.id);
  const districtId = user?.user_metadata?.district_id || sessionUser?.user_metadata?.district_id || null;
  const email = (user?.email || sessionUser?.email || '').toLowerCase();

  let districtName = user?.user_metadata?.district_name || sessionUser?.user_metadata?.district_name || '';
  if (districtId) {
    const { data: district } = await admin
      .from('districts')
      .select('id, name')
      .eq('id', districtId)
      .maybeSingle();
    districtName = district?.name || districtName || districtId;
  }

  let onboardingRequest = null;
  if (email) {
    const { data } = await admin
      .from('onboarding_requests')
      .select('id, organization_name, contact_email, payment_status, trial_status, access_status, trial_ends_at, stripe_customer_id')
      .eq('contact_email', email)
      .order('created_at', { ascending: false })
      .limit(1);
    onboardingRequest = data?.[0] || null;
    const metadata = { ...(sessionUser?.user_metadata || {}), ...(user?.user_metadata || {}) };
    if (onboardingRequest) {
      onboardingRequest = {
        ...onboardingRequest,
        payment_status: metadata.payment_status || onboardingRequest.payment_status,
        trial_status: metadata.trial_status || onboardingRequest.trial_status,
        access_status: metadata.access_status || onboardingRequest.access_status,
        trial_ends_at: metadata.trial_ends_at || onboardingRequest.trial_ends_at,
        stripe_customer_id: metadata.stripe_customer_id || onboardingRequest.stripe_customer_id,
      };
    }
  }

  const metadata = { ...(sessionUser?.user_metadata || {}), ...(user?.user_metadata || {}) };
  if (!onboardingRequest && (metadata.trial_ends_at || metadata.payment_status || metadata.trial_status)) {
    onboardingRequest = {
      id: '',
      organization_name: districtName || metadata.district_name || districtId || '',
      contact_email: email,
      payment_status: metadata.payment_status || 'pending',
      trial_status: metadata.trial_status || 'active',
      access_status: metadata.access_status || 'active',
      trial_ends_at: metadata.trial_ends_at || null,
      stripe_customer_id: metadata.stripe_customer_id || null,
    };
  }

  return { user: user || sessionUser, districtId, districtName, email, onboardingRequest };
}
