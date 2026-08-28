import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCanaryPricing } from '@/lib/pricing';
import { resolveCanaryPaymentCoverage } from '@/lib/payment-status.mjs';
import { loadCanaryAccountAccess } from '@/lib/account-access';

export async function getAuthenticatedBillingContext() {
  const supabase = await createClient();
  const { data: { user: sessionUser } } = await supabase.auth.getUser();
  if (!sessionUser?.id) return { user: null, districtId: null, districtName: null, email: null, onboardingRequest: null };

  const admin = createAdminClient();
  const { data: freshUserResult, error: freshUserError } = await admin.auth.admin.getUserById(sessionUser.id);
  const user = freshUserResult?.user;
  if (freshUserError || !user?.id) {
    throw new Error('Unable to verify current protected Canary account access.');
  }
  const protectedMetadata = { ...(user.app_metadata || {}) };
  const displayMetadata = { ...(user.user_metadata || {}) };
  const districtId = protectedMetadata.district_id || null;
  const email = String(user.email || '').toLowerCase();
  const billingUser = user;
  const accountAccess = await loadCanaryAccountAccess({ user: billingUser, admin });

  let districtName = displayMetadata.district_name || '';
  if (districtId) {
    const { data: district } = await admin
      .from('districts')
      .select('id, name')
      .eq('id', districtId)
      .maybeSingle();
    districtName = district?.name || districtName || districtId;
  }

  let onboardingRequest = accountAccess.onboardingRequest || null;
  if (onboardingRequest) {
      const coverage = resolveCanaryPaymentCoverage({
        protectedStatus: protectedMetadata.payment_status,
        protectedPaidThrough: protectedMetadata.paid_through,
        onboardingStatus: onboardingRequest.payment_status,
        onboardingPaidThrough: onboardingRequest.paid_through,
      });
      onboardingRequest = {
        ...onboardingRequest,
        payment_status: coverage.paymentStatus,
        trial_status: protectedMetadata.trial_status || onboardingRequest.trial_status,
        access_status: protectedMetadata.access_status || onboardingRequest.access_status,
        trial_ends_at: protectedMetadata.trial_ends_at || onboardingRequest.trial_ends_at,
        stripe_customer_id: protectedMetadata.stripe_customer_id || onboardingRequest.stripe_customer_id,
        paid_through: coverage.paidThrough,
        trial_starts_at: protectedMetadata.trial_starts_at || onboardingRequest.trial_starts_at || null,
      };
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

  const pricing = resolveCanaryPricing({ protectedMetadata: billingUser?.app_metadata || protectedMetadata });
  return { user: billingUser, districtId, districtName, email, onboardingRequest, pricing, accountAccess };
}
