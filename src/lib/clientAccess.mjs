import { resolveCanaryTrialAccess } from './trial-access.mjs';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function indexLifecycleRequests(requests = []) {
  const byId = new Map();
  const byEmail = new Map();
  for (const request of requests) {
    if (request?.id) byId.set(String(request.id), request);
    const email = normalizeEmail(request?.contact_email);
    if (!email) continue;
    const matches = byEmail.get(email) || [];
    matches.push(request);
    byEmail.set(email, matches);
  }
  return { byId, byEmail };
}

export function buildClientAccessDirectory(users = [], onboardingRequests = [], now = new Date()) {
  const lifecycle = indexLifecycleRequests(onboardingRequests);
  return users
    .filter((user) => {
      const metadata = user?.app_metadata || {};
      return Boolean(metadata.district_id) && !['admin', 'demo_reviewer'].includes(String(metadata.role || ''));
    })
    .map((user) => {
      const metadata = user.app_metadata || {};
      const profile = user.user_metadata || {};
      const requestId = metadata.onboarding_request_id ? String(metadata.onboarding_request_id) : '';
      const emailMatches = lifecycle.byEmail.get(normalizeEmail(user.email)) || [];
      const onboardingRequest = requestId ? lifecycle.byId.get(requestId) : emailMatches[0];
      const lifecycleAmbiguous = requestId ? !onboardingRequest : emailMatches.length > 1;
      const access = lifecycleAmbiguous
        ? { state: 'verification_required', reason: 'lifecycle_ambiguous', trialEndsAt: null }
        : resolveCanaryTrialAccess({ protectedMetadata: metadata, onboardingRequest, now });
      return {
        id: user.id,
        district_id: metadata.district_id,
        first_name: profile.first_name || '',
        last_name: profile.last_name || '',
        email: user.email || '',
        created_at: user.created_at || null,
        last_sign_in_at: user.last_sign_in_at || null,
        access_state: access.state,
        access_reason: access.reason,
        trial_ends_at: access.trialEndsAt || null,
      };
    })
    .sort((left, right) => {
      const districtCompare = String(left.district_id).localeCompare(String(right.district_id));
      if (districtCompare) return districtCompare;
      return String(left.email).localeCompare(String(right.email));
    });
}
