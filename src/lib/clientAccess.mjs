import { resolveCanaryTrialAccess } from './trial-access.mjs';

export function buildClientAccessDirectory(users = [], now = new Date()) {
  return users
    .filter((user) => {
      const metadata = user?.app_metadata || {};
      return Boolean(metadata.district_id) && !['admin', 'demo_reviewer'].includes(String(metadata.role || ''));
    })
    .map((user) => {
      const metadata = user.app_metadata || {};
      const profile = user.user_metadata || {};
      const access = resolveCanaryTrialAccess({ protectedMetadata: metadata, now });
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
