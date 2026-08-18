const scenario = process.env.CANARY_OPS_TEST_SCENARIO;
function response(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  if (parsed.pathname === '/auth/v1/admin/users') {
    if (scenario === 'duplicate-customer') {
      return response({ users: [
        { id: 'user-1', email: 'one@district.org', app_metadata: { district_id: 'district-1', stripe_customer_id: 'cus_duplicate' } },
        { id: 'user-2', email: 'two@district.org', app_metadata: { district_id: 'district-2', stripe_customer_id: 'cus_duplicate' } },
      ] });
    }
    if (scenario === 'paid-downgrade') {
      return response({ users: [{
        id: 'user-paid', email: 'paid@district.org',
        app_metadata: { district_id: 'district-1', payment_status: 'paid', payment_paid_at: '2026-09-02T00:00:00Z' },
      }] });
    }
    if (scenario === 'cas-conflict') {
      return response({ users: [{
        id: '00000000-0000-0000-0000-000000000001', email: 'lock@district.org', app_metadata: { district_id: 'district-1' },
      }] });
    }
    if (scenario === 'pagination-cap') {
      const page = Number(parsed.searchParams.get('page'));
      return response({ users: Array.from({ length: 100 }, (_, index) => ({
        id: `user-${page}-${index}`, email: `user-${page}-${index}@district.org`, app_metadata: { district_id: 'district-1' },
      })) });
    }
  }
  if (scenario === 'cas-conflict' && parsed.pathname === '/rest/v1/rpc/patch_canary_protected_app_metadata') {
    return response({ message: 'Protected Canary metadata changed before guarded update' }, false, 409);
  }
  throw new Error(`Unexpected mutation/network request in ${scenario}: ${options.method || 'GET'} ${parsed.pathname}`);
};
