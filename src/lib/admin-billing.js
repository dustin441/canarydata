import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildAdminBillingOverview, mergeAdminBillingRecords } from './admin-billing.mjs';

const ADMIN_BILLING_COLUMNS = 'id, organization_name, contact_email, payment_status, trial_status, access_status, trial_starts_at, trial_ends_at, paid_at, paid_through, po_number';

async function listAllAuthUsers(admin) {
  const users = [];
  const perPage = 1000;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < perPage) return users;
  }
  throw new Error('Canary billing user pagination exceeded the safety limit.');
}

export async function getAdminBillingOverview() {
  const sessionClient = await createClient();
  const { data: { user: sessionUser } } = await sessionClient.auth.getUser();
  if (!sessionUser?.id) {
    const error = new Error('Authentication required.');
    error.status = 401;
    throw error;
  }

  const admin = createAdminClient();
  const { data: freshUserResult, error: userError } = await admin.auth.admin.getUserById(sessionUser.id);
  if (userError || freshUserResult?.user?.app_metadata?.role !== 'admin') {
    const error = new Error('Canary administrator access is required.');
    error.status = 403;
    throw error;
  }

  const [{ data, error }, authUsers] = await Promise.all([
    admin.from('onboarding_requests').select(ADMIN_BILLING_COLUMNS).order('organization_name'),
    listAllAuthUsers(admin),
  ]);
  if (error) throw error;
  return buildAdminBillingOverview(mergeAdminBillingRecords(data || [], authUsers));
}
