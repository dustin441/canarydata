import { isCanaryAccountHardDenied, resolveCanaryTrialAccess } from './trial-access.mjs';

export async function loadCanaryAccountAccess({ user, admin, now = new Date() }) {
  if (!user) {
    const error = new Error('Canary account could not be verified.');
    error.status = 401;
    throw error;
  }
  const protectedMetadata = user.app_metadata || {};
  const protectedAccess = resolveCanaryTrialAccess({ protectedMetadata, now });
  if (protectedAccess.reason === 'account_revoked') {
    return { ...protectedAccess, onboardingRequest: null };
  }
  let onboardingRequest = null;
  const email = String(user.email || '').trim().toLowerCase();
  if (email && admin) {
    let query = admin
      .from('onboarding_requests')
      .select('id, organization_name, contact_email, payment_status, paid_through, trial_status, access_status, trial_starts_at, trial_ends_at, stripe_customer_id, po_number')
      .eq('contact_email', email);
    if (protectedMetadata.onboarding_request_id) query = query.eq('id', protectedMetadata.onboarding_request_id);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(2);
    if (error && error.code !== 'PGRST205') {
      const accessError = new Error('Canary account access could not be verified.');
      accessError.status = 503;
      throw accessError;
    }
    // Compatibility for deployments that predate the onboarding_requests table.
    if (error?.code !== 'PGRST205') {
      if (data?.length > 1 || (protectedMetadata.onboarding_request_id && data?.length !== 1)) {
        const accessError = new Error('Canary account lifecycle association is ambiguous.');
        accessError.status = 503;
        throw accessError;
      }
      onboardingRequest = data?.[0] || null;
    }
  }

  const resolved = resolveCanaryTrialAccess({ protectedMetadata, onboardingRequest, now });
  if (resolved.reason === 'account_revoked') return { ...resolved, onboardingRequest };
  const role = protectedMetadata.role || null;
  if (role === 'admin' || role === 'demo_reviewer') {
    return { allowed: true, state: 'active', reason: 'privileged_role', trialEndsAt: null, onboardingRequest };
  }
  return {
    ...resolved,
    onboardingRequest,
  };
}

export async function requireCanaryAccountAccess(options) {
  const access = await loadCanaryAccountAccess(options);
  if (!access.allowed) {
    const error = new Error(access.reason === 'account_revoked'
      ? 'Canary account access has been disabled.'
      : 'Your Canary access period has ended. Continue through Billing or contact Canary Data.');
    error.status = 403;
    error.code = access.reason === 'account_revoked' ? 'CANARY_ACCESS_REVOKED' : 'CANARY_ACCESS_ENDED';
    error.access = access;
    throw error;
  }
  return access;
}
