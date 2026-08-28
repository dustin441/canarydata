#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { INTRODUCTORY_ANNUAL_PRICE_CENTS, NSPRA_2026_OFFER_CODE, NSPRA_2026_OFFER_EXPIRES_AT, PRICING_POLICY_VERSION, isValidNspraPoEntitlement } from '../src/lib/pricing.js';
import { validateAuthoritativeNspraRoster } from './lib/nspra-roster.mjs';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    if (key === 'apply') out.apply = true;
    else out[key] = argv[++i];
  }
  return out;
}
async function loadEnv(path) {
  if (!path) return;
  const text = await readFile(path, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}
const options = args(process.argv.slice(2));
await loadEnv(options['env-file']);
const email = String(options.email || '').trim().toLowerCase();
const rosterFile = String(options['roster-file'] || '').trim();
const poNumber = String(options['po-number'] || '').trim().slice(0, 80);
if (!email.includes('@') || !rosterFile || !/^[A-Za-z0-9][A-Za-z0-9._/# -]{1,79}$/.test(poNumber)) {
  throw new Error('Usage: qualify-canary-nspra-po.mjs --email EMAIL --roster-file PRIVATE_JSON --po-number VALID_PO [--env-file PATH] [--apply]');
}
const roster = JSON.parse(await readFile(rosterFile, 'utf8'));
if (roster?.program !== NSPRA_2026_OFFER_CODE || !Array.isArray(roster?.contacts)) throw new Error('Roster file is not the authoritative nspra_2026 finite-list format.');
validateAuthoritativeNspraRoster(roster);
const rosterMatches = roster.contacts.filter((entry) => String(entry?.email || '').trim().toLowerCase() === email);
if (rosterMatches.length !== 1) throw new Error(`Expected exactly one finite-roster entry for ${email}; found ${rosterMatches.length}.`);
const eligibilityReference = String(rosterMatches[0]?.eligibility_reference || '').trim().slice(0, 200);
if (!eligibilityReference) throw new Error('The finite-roster entry must include an eligibility_reference.');
const requestedAtMs = Date.now();
const expiresAtMs = Date.parse(NSPRA_2026_OFFER_EXPIRES_AT);
if (!Number.isFinite(requestedAtMs)) throw new Error('Unable to determine the current qualification time.');
const base = String(process.env.CANARY_PROD_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!base || !key) throw new Error('Canonical Canary Supabase URL and service-role key are required.');
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
let matches = [];
let exhausted = false;
for (let page = 1; page <= 50; page += 1) {
  const response = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=100`, { headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to list Canary Auth users (${response.status}).`);
  const users = (await response.json()).users || [];
  matches.push(...users.filter((user) => String(user.email || '').trim().toLowerCase() === email));
  if (users.length < 100) { exhausted = true; break; }
}
if (!exhausted) throw new Error('Canary Auth pagination reached the 5,000-user safety cap before exhaustion.');
if (matches.length !== 1) throw new Error(`Expected exactly one Canary Auth user for ${email}; found ${matches.length}.`);
const user = matches[0];
const current = user.app_metadata || {};
if (!current.district_id) throw new Error('Refusing to qualify NSPRA pricing without a protected Canary district owner.');
const existingAnnual = Number(current.annual_price_cents || 0);
const existingRenewal = Number(current.renewal_price_cents || 0);
if (current.account_enabled === false || ['revoked', 'disabled', 'suspended_security', 'terminated'].includes(String(current.access_status || '').toLowerCase())) {
  throw new Error('Refusing to qualify pricing for a disabled Canary account.');
}
const sameQualification = isValidNspraPoEntitlement(current, { poNumber, eligibilityReference });
if (sameQualification) {
  console.log(JSON.stringify({ apply: options.apply === true, dryRun: options.apply !== true, idempotent: true, userId: user.id, email, districtId: current.district_id, annualPriceCents: existingAnnual, renewalPriceCents: existingRenewal, lockedAt: current.pricing_locked_at, readbackVerified: true }, null, 2));
  process.exit(0);
}
if (requestedAtMs >= expiresAtMs) throw new Error(`A valid NSPRA PO number must be received before ${NSPRA_2026_OFFER_EXPIRES_AT}.`);
const allowedUnpaidStatuses = new Set(['', 'pending', 'unpaid', 'trial']);
const protectedLockFields = ['pricing_lock_status', 'pricing_lock_reason', 'pricing_locked_at', 'pricing_po_status', 'pricing_po_number'];
const hasIndependentLock = protectedLockFields.some((field) => current[field] !== undefined && current[field] !== null && current[field] !== '');
const offerFieldsPresent = ['pricing_offer_code', 'pricing_offer_status', 'pricing_offer_source', 'pricing_offer_expires_at', 'pricing_offer_eligibility_reference']
  .some((field) => current[field] !== undefined && current[field] !== null && current[field] !== '');
const compatibleFiniteOffer = !offerFieldsPresent || (current.pricing_offer_code === NSPRA_2026_OFFER_CODE
  && current.pricing_offer_status === 'eligible'
  && current.pricing_offer_source === 'nspra_2026_finite_list'
  && current.pricing_offer_expires_at === NSPRA_2026_OFFER_EXPIRES_AT
  && current.pricing_offer_eligibility_reference === eligibilityReference);
if (!allowedUnpaidStatuses.has(String(current.payment_status || '').toLowerCase()) || existingAnnual || existingRenewal
  || current.pricing_entitlement_reason || hasIndependentLock || !compatibleFiniteOffer) {
  throw new Error('Refusing to downgrade or overwrite an existing paid, standard, conflicting, or independently locked pricing entitlement.');
}
const lockedAt = new Date(requestedAtMs).toISOString();
const pricingPatch = {
  annual_price_cents: INTRODUCTORY_ANNUAL_PRICE_CENTS,
  renewal_price_cents: INTRODUCTORY_ANNUAL_PRICE_CENTS,
  pricing_policy_version: PRICING_POLICY_VERSION,
  pricing_lock_status: 'approved',
  pricing_lock_reason: 'nspra_2026_valid_po',
  pricing_entitlement_reason: 'nspra_2026_valid_po',
  pricing_po_status: 'received',
  pricing_po_number: poNumber,
  pricing_locked_at: lockedAt,
  pricing_offer_code: NSPRA_2026_OFFER_CODE,
  pricing_offer_status: 'qualified',
  pricing_offer_source: 'nspra_2026_finite_list',
  pricing_offer_expires_at: NSPRA_2026_OFFER_EXPIRES_AT,
  pricing_offer_eligibility_reference: eligibilityReference,
};
if (!options.apply) {
  console.log(JSON.stringify({ apply: false, dryRun: true, idempotent: false, userId: user.id, email, districtId: current.district_id, proposedAnnualPriceCents: INTRODUCTORY_ANNUAL_PRICE_CENTS, proposedRenewalPriceCents: INTRODUCTORY_ANNUAL_PRICE_CENTS, lockedAt, offerCode: NSPRA_2026_OFFER_CODE }, null, 2));
  process.exit(0);
}
const update = await fetch(`${base}/rest/v1/rpc/patch_canary_protected_app_metadata`, {
  method: 'POST', headers, cache: 'no-store',
  body: JSON.stringify({ p_auth_user_id: user.id, p_district_id: String(current.district_id), p_expected_customer_id: String(current.stripe_customer_id || ''), p_expected_app_metadata: current, p_patch: pricingPatch }),
});
if (!update.ok) throw new Error(`Unable to atomically save NSPRA PO qualification (${update.status}).`);
const readback = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { headers, cache: 'no-store' });
if (!readback.ok) throw new Error(`Unable to verify NSPRA PO qualification (${readback.status}).`);
const saved = (await readback.json()).app_metadata || {};
const verified = isValidNspraPoEntitlement(saved, { poNumber, eligibilityReference })
  && saved.pricing_locked_at === lockedAt;
if (!verified) throw new Error('NSPRA PO qualification readback did not match the requested protected lock.');
console.log(JSON.stringify({ apply: true, dryRun: false, idempotent: false, userId: user.id, email, districtId: saved.district_id, annualPriceCents: saved.annual_price_cents, renewalPriceCents: saved.renewal_price_cents, lockedAt: saved.pricing_locked_at, readbackVerified: true }, null, 2));
