import { validatePurchaseOrder } from './purchase-order.mjs';

function status(value, fallback = 'unknown') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
}

function firstValue(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== '');
}

function strongerStatus(current, incoming, ranks) {
  const currentValue = String(current || '').trim().toLowerCase();
  const incomingValue = String(incoming || '').trim().toLowerCase();
  return (ranks[incomingValue] || 0) > (ranks[currentValue] || 0) ? incoming : firstValue(current, incoming);
}

function dateValue(current, incoming, mode = 'latest') {
  const values = [current, incoming].filter((value) => Number.isFinite(Date.parse(value || '')));
  if (!values.length) return firstValue(current, incoming);
  return values.sort((a, b) => Date.parse(a) - Date.parse(b))[mode === 'earliest' ? 0 : values.length - 1];
}

function validDate(value) {
  return Number.isFinite(Date.parse(value || ''));
}

function verifiedCheckPayment(record) {
  const profilePayment = record?.confirmed_profile?.billing_payment || {};
  const protectedPayment = record?._protectedCheckPayment || {};
  const evidence = protectedPayment.depositedAt ? protectedPayment : {
    method: profilePayment.method,
    status: profilePayment.status,
    depositedAt: profilePayment.deposited_at,
    verifiedBy: profilePayment.verified_by,
  };
  return String(evidence.method || '').toLowerCase() === 'check'
    && String(evidence.status || '').toLowerCase() === 'deposited'
    && validDate(evidence.depositedAt)
    && Boolean(String(evidence.verifiedBy || '').trim());
}

function billingPaymentMethod(record) {
  const paymentStatus = status(record.payment_status, 'pending');
  if (paymentStatus === 'complimentary') return 'complimentary';
  if (paymentStatus !== 'paid') return 'unknown';
  if (record._stripePaymentConfirmed === true) return 'stripe_card';
  if (verifiedCheckPayment(record)) return 'check';
  return 'unknown';
}

function confirmedPaymentStatus(record, paymentMethod) {
  const storedStatus = status(record.payment_status, 'pending');
  if (storedStatus === 'paid' && !['stripe_card', 'check'].includes(paymentMethod)) return 'verification_needed';
  return storedStatus;
}

function billingFollowUpReason(record, nowMs) {
  const accessStatus = status(record.access_status, 'pending_setup');
  const paymentStatus = status(record.payment_status, 'pending');
  const trialStatus = status(record.trial_status, 'not_started');
  if (accessStatus === 'manual_hold') return 'Manual access decision';
  if (accessStatus === 'pending_setup' || accessStatus === 'configuration_in_progress') return 'Setup incomplete';
  if (paymentStatus === 'paid' && billingPaymentMethod(record) === 'unknown') return 'Payment needs verification';
  if (paymentStatus === 'failed') return 'Payment failed';
  const paymentCovered = paymentStatus === 'paid' || paymentStatus === 'complimentary';
  if (!paymentCovered && trialStatus === 'expired') return 'Trial ended unpaid';
  const trialEndsAt = Date.parse(record.trial_ends_at || '');
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  if (!paymentCovered && trialStatus === 'active' && Number.isFinite(trialEndsAt)
    && trialEndsAt > nowMs && trialEndsAt - nowMs <= sevenDaysMs) return 'Trial ends within 7 days';
  return null;
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function paymentMethodLabel(value) {
  if (value === 'stripe_card') return 'Stripe/card';
  if (value === 'check') return 'Check';
  if (value === 'complimentary') return 'Complimentary';
  return 'Unknown';
}

export function buildAdminBillingCsv(rows = []) {
  const headers = [
    'Organization', 'Contact Email', 'Payment Status', 'Payment Method', 'Trial Status', 'Access Status',
    'PO Status', 'Follow-up Reason', 'Follow-up Owner', 'Trial Starts', 'Trial Ends', 'Paid Date', 'Paid Through',
    'Sales Attribution Owner', 'Commission Eligible', 'Request Created',
  ];
  const lines = (rows || []).map((row) => [
    row.organizationName, row.contactEmail, row.paymentStatus, paymentMethodLabel(row.paymentMethod), row.trialStatus,
    row.accessStatus, row.poState, row.followUpReason, row.followUpOwner, row.trialStartsAt, row.trialEndsAt,
    row.paidAt, row.paidThrough, row.salesAttributionOwner, row.commissionEligible ? 'Yes' : 'No', row.createdAt,
  ].map(csvCell).join(','));
  return [headers.join(','), ...lines].join('\r\n');
}

export function filterAdminBillingRows(rows = [], { searchTerm = '', statusFilter = 'all' } = {}) {
  const query = String(searchTerm || '').trim().toLowerCase();
  return (rows || []).filter((row) => {
    const searchable = [
      row.organizationName, row.contactEmail, row.salesAttributionOwner, row.followUpOwner, row.followUpReason,
      row.paymentMethod, row.paymentStatus, row.trialStatus, row.accessStatus,
    ].filter(Boolean).join(' ').toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (statusFilter === 'paid') return row.paymentStatus === 'paid';
    if (statusFilter === 'payment_pending') return ['pending', 'failed', 'verification_needed'].includes(row.paymentStatus);
    if (statusFilter === 'active_trials') return row.trialStatus === 'active';
    if (statusFilter === 'active_access') return row.accessStatus === 'active';
    if (statusFilter === 'manual_hold') return row.accessStatus === 'manual_hold';
    if (statusFilter === 'follow_up') return Boolean(row.followUpReason);
    if (statusFilter === 'commission') return row.commissionEligible === true;
    return true;
  });
}

function isIncludedBillingUser(user) {
  const protectedMetadata = user?.app_metadata || {};
  const hasLifecycle = protectedMetadata.district_id
    || protectedMetadata.onboarding_request_id
    || protectedMetadata.payment_status
    || protectedMetadata.trial_status
    || protectedMetadata.access_status;
  return Boolean(user?.id && hasLifecycle)
    && protectedMetadata.role !== 'admin'
    && protectedMetadata.role !== 'demo_reviewer'
    && protectedMetadata.is_test_account !== true
    && protectedMetadata.demo_reviewer !== true;
}

export function mergeAdminBillingRecords(onboardingRecords = [], authUsers = []) {
  const records = new Map((onboardingRecords || []).map((record) => [String(record.id), { ...record }]));
  const requestIdByEmail = new Map((onboardingRecords || [])
    .filter((record) => record.contact_email)
    .map((record) => [String(record.contact_email).trim().toLowerCase(), String(record.id)]));
  const requestIdByDistrict = new Map();
  for (const user of authUsers || []) {
    if (!isIncludedBillingUser(user)) continue;
    const protectedMetadata = user?.app_metadata || {};
    const districtId = String(protectedMetadata.district_id || '');
    const requestId = String(protectedMetadata.onboarding_request_id
      || requestIdByEmail.get(String(user?.email || '').trim().toLowerCase())
      || '');
    if (districtId && requestId && records.has(requestId)) requestIdByDistrict.set(districtId, requestId);
  }
  for (const user of authUsers || []) {
    if (!isIncludedBillingUser(user)) continue;
    const protectedMetadata = user?.app_metadata || {};
    const displayMetadata = user?.user_metadata || {};
    const districtId = String(protectedMetadata.district_id || '');
    const requestId = String(protectedMetadata.onboarding_request_id
      || requestIdByEmail.get(String(user.email || '').trim().toLowerCase())
      || requestIdByDistrict.get(districtId)
      || '');
    const id = requestId || (districtId ? `district:${districtId}` : `auth:${user.id}`);
    const current = records.get(id) || { id };
    const incomingPaymentStatus = String(protectedMetadata.payment_status || '').trim().toLowerCase();
    const incomingPaymentCovered = incomingPaymentStatus === 'paid' || incomingPaymentStatus === 'complimentary';
    const hasProtectedPayment = Object.hasOwn(protectedMetadata, 'payment_status')
      || Object.hasOwn(protectedMetadata, 'payment_paid_at')
      || Object.hasOwn(protectedMetadata, 'paid_through')
      || Object.hasOwn(protectedMetadata, 'stripe_checkout_session_id')
      || Object.hasOwn(protectedMetadata, 'check_deposited_at');
    const hasProtectedTrial = Object.hasOwn(protectedMetadata, 'trial_status')
      || Object.hasOwn(protectedMetadata, 'trial_starts_at')
      || Object.hasOwn(protectedMetadata, 'trial_ends_at');
    const hasProtectedAccess = Object.hasOwn(protectedMetadata, 'access_status');
    const paymentStatus = Object.hasOwn(protectedMetadata, 'payment_status') && !current._authPaymentSeen
      ? protectedMetadata.payment_status
      : strongerStatus(current.payment_status, protectedMetadata.payment_status, { paid: 100, complimentary: 90, pending: 20, failed: 10 });
    const trialStatus = Object.hasOwn(protectedMetadata, 'trial_status') && !current._authTrialSeen
      ? protectedMetadata.trial_status
      : strongerStatus(current.trial_status, protectedMetadata.trial_status, { converted: 100, active: 90, expired: 20, not_started: 10 });
    const accessStatus = hasProtectedAccess && !current._authAccessSeen
      ? protectedMetadata.access_status
      : strongerStatus(current.access_status, protectedMetadata.access_status, { active: 100, pending_setup: 20, expired: 10, revoked: 5, disabled: 5 });
    const paidAt = hasProtectedPayment && !current._authPaymentSeen
      ? (incomingPaymentCovered ? protectedMetadata.payment_paid_at || null : null)
      : incomingPaymentCovered
        ? dateValue(current.paid_at, protectedMetadata.payment_paid_at)
        : current.paid_at;
    const paidThrough = hasProtectedPayment && !current._authPaymentSeen
      ? (incomingPaymentCovered ? protectedMetadata.paid_through || null : null)
      : incomingPaymentCovered
        ? dateValue(current.paid_through, protectedMetadata.paid_through)
        : current.paid_through;
    const trialStartsAt = hasProtectedTrial && !current._authTrialSeen
      ? protectedMetadata.trial_starts_at || null
      : dateValue(current.trial_starts_at, protectedMetadata.trial_starts_at, 'earliest');
    const trialEndsAt = hasProtectedTrial && !current._authTrialSeen
      ? protectedMetadata.trial_ends_at || null
      : dateValue(current.trial_ends_at, protectedMetadata.trial_ends_at);
    const protectedCheckPayment = {
      method: protectedMetadata.payment_method,
      status: protectedMetadata.check_payment_status,
      depositedAt: protectedMetadata.check_deposited_at,
      verifiedBy: protectedMetadata.check_verified_by,
    };
    records.set(id, {
      ...current,
      _authPaymentSeen: current._authPaymentSeen || hasProtectedPayment,
      _authTrialSeen: current._authTrialSeen || hasProtectedTrial,
      _authAccessSeen: current._authAccessSeen || hasProtectedAccess,
      organization_name: firstValue(
        current.organization_name,
        displayMetadata.billing_organization_name,
        displayMetadata.district_name,
        protectedMetadata.district_id,
      ),
      contact_email: firstValue(current.contact_email, user.email),
      po_number: firstValue(current.po_number, displayMetadata.po_number),
      payment_status: paymentStatus,
      trial_status: trialStatus,
      access_status: accessStatus,
      trial_starts_at: trialStartsAt,
      trial_ends_at: trialEndsAt,
      paid_at: paidAt,
      paid_through: paidThrough,
      _stripePaymentConfirmed: current._stripePaymentConfirmed || (
        incomingPaymentStatus === 'paid'
        && validDate(protectedMetadata.payment_paid_at)
        && Boolean(String(protectedMetadata.stripe_checkout_session_id || '').trim())
      ),
      _protectedCheckPayment: validDate(current._protectedCheckPayment?.depositedAt)
        ? current._protectedCheckPayment
        : protectedCheckPayment,
    });
  }
  return [...records.values()]
    .map(({ _authPaymentSeen, _authTrialSeen, _authAccessSeen, ...record }) => record)
    .sort((a, b) => String(a.organization_name || '').localeCompare(String(b.organization_name || '')));
}

export function buildAdminBillingOverview(records = [], now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const rows = (records || []).map((record) => {
    const po = validatePurchaseOrder(record.po_number);
    const salesAttribution = record.confirmed_profile?.sales_attribution || {};
    const followUp = record.confirmed_profile?.follow_up || {};
    const paymentMethod = billingPaymentMethod(record);
    const paymentStatus = confirmedPaymentStatus(record, paymentMethod);
    const paymentConfirmed = paymentStatus === 'paid';
    return {
      id: record.id,
      organizationName: record.organization_name || 'Unnamed organization',
      contactEmail: String(record.contact_email || '').trim().toLowerCase(),
      poState: po.valid ? 'valid' : po.present ? 'invalid' : 'missing',
      paymentStatus,
      paymentMethod,
      trialStatus: status(record.trial_status, 'not_started'),
      accessStatus: status(record.access_status, 'pending_setup'),
      trialStartsAt: record.trial_starts_at || null,
      trialEndsAt: record.trial_ends_at || null,
      paidAt: paymentConfirmed ? (record.paid_at || record._protectedCheckPayment?.depositedAt || null) : null,
      paidThrough: paymentConfirmed || paymentStatus === 'complimentary' ? (record.paid_through || null) : null,
      salesAttributionOwner: String(salesAttribution.owner || '').trim(),
      commissionEligible: salesAttribution.commission_eligible === true,
      followUpOwner: String(followUp.owner || '').trim(),
      followUpReason: billingFollowUpReason(record, nowMs),
      createdAt: record.created_at || null,
      expectedUpdatedAt: record.updated_at || null,
    };
  });

  return {
    rows,
    summary: {
      organizations: rows.length,
      paid: rows.filter((row) => row.paymentStatus === 'paid').length,
      paymentPending: rows.filter((row) => ['pending', 'failed', 'verification_needed'].includes(row.paymentStatus)).length,
      poValid: rows.filter((row) => row.poState === 'valid').length,
      poMissing: rows.filter((row) => row.poState === 'missing').length,
      poInvalid: rows.filter((row) => row.poState === 'invalid').length,
      activeTrials: rows.filter((row) => row.trialStatus === 'active'
        && Number.isFinite(Date.parse(row.trialEndsAt || ''))
        && Date.parse(row.trialEndsAt) > nowMs).length,
      activeAccess: rows.filter((row) => row.accessStatus === 'active').length,
      followUp: rows.filter((row) => Boolean(row.followUpReason)).length,
    },
  };
}
