const scenario = process.env.CANARY_OPS_TEST_SCENARIO;
let savedPatch = {};
if (scenario === 'nspra-po-late-idempotent' || scenario === 'nspra-po-late-new') Date.now = () => Date.parse('2026-10-02T00:00:00-07:00');
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
    if (scenario === 'nspra-dry-run') {
      return response({ users: [{
        id: 'user-nspra', email: 'nspra@district.org', app_metadata: { district_id: 'district-nspra' },
      }] });
    }
    if (scenario === 'nspra-idempotent') {
      return response({ users: [{
        id: 'user-nspra', email: 'nspra@district.org', app_metadata: {
          district_id: 'district-nspra', pricing_offer_code: 'nspra_2026', pricing_offer_status: 'eligible',
          pricing_offer_source: 'nspra_2026_finite_list', pricing_offer_granted_at: '2026-08-28T12:00:00.000Z',
          pricing_offer_expires_at: '2026-10-01T00:00:00-07:00', pricing_offer_eligibility_reference: 'sheet-row-2',
        },
      }] });
    }
    if (scenario === 'nspra-po-dry-run' || scenario === 'nspra-po-apply' || scenario === 'nspra-po-late-new') {
      return response({ users: [{
        id: 'user-nspra', email: 'nspra@district.org', app_metadata: {
          district_id: 'district-nspra', pricing_offer_code: 'nspra_2026', pricing_offer_status: 'eligible',
          pricing_offer_source: 'nspra_2026_finite_list', pricing_offer_expires_at: '2026-10-01T00:00:00-07:00',
          pricing_offer_eligibility_reference: 'sheet-row-2',
        },
      }] });
    }
    if (scenario === 'nspra-po-complimentary') {
      return response({ users: [{
        id: 'user-nspra', email: 'nspra@district.org', app_metadata: { district_id: 'district-nspra', payment_status: 'complimentary', pricing_offer_code: 'nspra_2026' },
      }] });
    }
    if (scenario === 'nspra-po-idempotent' || scenario === 'nspra-po-late-idempotent') {
      return response({ users: [{
        id: 'user-nspra', email: 'nspra@district.org', app_metadata: {
          district_id: 'district-nspra', annual_price_cents: 149900, renewal_price_cents: 149900,
          pricing_policy_version: '2026-09-01-v1', pricing_entitlement_reason: 'nspra_2026_valid_po',
          pricing_lock_status: 'approved', pricing_lock_reason: 'nspra_2026_valid_po',
          pricing_po_status: 'received', pricing_po_number: 'PO-2026-1',
          pricing_offer_code: 'nspra_2026', pricing_offer_status: 'qualified', pricing_offer_source: 'nspra_2026_finite_list',
          pricing_offer_expires_at: '2026-10-01T00:00:00-07:00', pricing_offer_eligibility_reference: 'sheet-row-2',
          pricing_locked_at: '2026-08-28T12:00:00.000Z',
        },
      }] });
    }
    if (scenario === 'pagination-cap') {
      const page = Number(parsed.searchParams.get('page'));
      return response({ users: Array.from({ length: 100 }, (_, index) => ({
        id: `user-${page}-${index}`, email: `user-${page}-${index}@district.org`, app_metadata: { district_id: 'district-1' },
      })) });
    }
  }
  if (scenario === 'nspra-po-apply' && parsed.pathname === '/rest/v1/rpc/patch_canary_protected_app_metadata') {
    savedPatch = JSON.parse(options.body || '{}').p_patch || {};
    return response(savedPatch);
  }
  if (scenario === 'nspra-po-apply' && parsed.pathname === '/auth/v1/admin/users/user-nspra') {
    return response({ app_metadata: { district_id: 'district-nspra', ...savedPatch } });
  }
  if (scenario === 'cas-conflict' && parsed.pathname === '/rest/v1/rpc/patch_canary_protected_app_metadata') {
    return response({ message: 'Protected Canary metadata changed before guarded update' }, false, 409);
  }
  throw new Error(`Unexpected mutation/network request in ${scenario}: ${options.method || 'GET'} ${parsed.pathname}`);
};
