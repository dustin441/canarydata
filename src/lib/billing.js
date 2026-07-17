import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function getAuthenticatedBillingContext() {
  const supabase = await createClient();
  const { data: { user: sessionUser } } = await supabase.auth.getUser();
  if (!sessionUser?.id) return { user: null, districtId: null, districtName: null, email: null, onboardingRequest: null };

  const admin = createAdminClient();
  const { data: { user } } = await admin.auth.admin.getUserById(sessionUser.id);
  const protectedMetadata = { ...(sessionUser?.app_metadata || {}), ...(user?.app_metadata || {}) };
  const displayMetadata = { ...(sessionUser?.user_metadata || {}), ...(user?.user_metadata || {}) };
  const districtId = protectedMetadata.district_id || null;
  const email = (user?.email || sessionUser?.email || '').toLowerCase();

  let districtName = displayMetadata.district_name || '';
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
    if (onboardingRequest) {
      onboardingRequest = {
        ...onboardingRequest,
        payment_status: protectedMetadata.payment_status || onboardingRequest.payment_status,
        trial_status: protectedMetadata.trial_status || onboardingRequest.trial_status,
        access_status: protectedMetadata.access_status || onboardingRequest.access_status,
        trial_ends_at: protectedMetadata.trial_ends_at || onboardingRequest.trial_ends_at,
        stripe_customer_id: protectedMetadata.stripe_customer_id || onboardingRequest.stripe_customer_id,
        paid_through: protectedMetadata.paid_through || onboardingRequest.paid_through || null,
        trial_starts_at: protectedMetadata.trial_starts_at || onboardingRequest.trial_starts_at || null,
      };
    }
  }

  if (!onboardingRequest && (protectedMetadata.trial_ends_at || protectedMetadata.payment_status || protectedMetadata.trial_status)) {
    onboardingRequest = {
      id: '',
      organization_name: districtName || districtId || '',
      contact_email: email,
      payment_status: protectedMetadata.payment_status || 'pending',
      trial_status: protectedMetadata.trial_status || 'active',
      access_status: protectedMetadata.access_status || 'active',
      trial_starts_at: protectedMetadata.trial_starts_at || null,
      trial_ends_at: protectedMetadata.trial_ends_at || null,
      paid_through: protectedMetadata.paid_through || null,
      stripe_customer_id: protectedMetadata.stripe_customer_id || null,
    };
  }

  return { user: user || sessionUser, districtId, districtName, email, onboardingRequest };
}
