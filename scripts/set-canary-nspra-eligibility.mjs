#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  NSPRA_2026_OFFER_CODE,
  NSPRA_2026_OFFER_EXPIRES_AT,
} from '../src/lib/pricing.js';
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
if (!email.includes('@') || !rosterFile) {
  throw new Error('Usage: set-canary-nspra-eligibility.mjs --email EMAIL --roster-file PRIVATE_JSON [--env-file PATH] [--apply]');
}
const roster = JSON.parse(await readFile(rosterFile, 'utf8'));
if (roster?.program !== NSPRA_2026_OFFER_CODE || !Array.isArray(roster?.contacts)) {
  throw new Error('Roster file is not the authoritative nspra_2026 finite-list format.');
}
validateAuthoritativeNspraRoster(roster);
const rosterMatches = roster.contacts.filter((contact) => String(contact?.email || '').trim().toLowerCase() === email);
if (rosterMatches.length !== 1) throw new Error(`Expected exactly one finite-roster entry for ${email}; found ${rosterMatches.length}.`);
const eligibilityReference = String(rosterMatches[0]?.eligibility_reference || '').trim().slice(0, 200);
if (!eligibilityReference) throw new Error('The finite-roster entry must include an eligibility_reference.');
const requestedAtMs = Date.now();
const expiresAtMs = Date.parse(NSPRA_2026_OFFER_EXPIRES_AT);
if (!Number.isFinite(requestedAtMs)) throw new Error('Unable to determine the current NSPRA eligibility time.');

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
  matches.push(...users.filter((user) => String(user.email || '').toLowerCase() === email));
  if (users.length < 100) { exhausted = true; break; }
}
if (!exhausted) throw new Error('Canary Auth pagination reached the 5,000-user safety cap before exhaustion.');
if (matches.length !== 1) throw new Error(`Expected exactly one Canary Auth user for ${email}; found ${matches.length}.`);

const user = matches[0];
const current = user.app_metadata || {};
if (!current.district_id) throw new Error('Refusing to set NSPRA eligibility without a protected Canary district owner.');
const existingAnnual = Number(current.annual_price_cents || 0);
const existingRenewal = Number(current.renewal_price_cents || 0);
if (current.account_enabled === false || ['revoked', 'disabled', 'suspended_security', 'terminated'].includes(String(current.access_status || '').toLowerCase())) {
  throw new Error('Refusing to grant pricing eligibility to a disabled Canary account.');
}
const existingGrantedAtMs = Date.parse(String(current.pricing_offer_granted_at || ''));
const sameFiniteRosterGrant = current.pricing_offer_code === NSPRA_2026_OFFER_CODE
  && current.pricing_offer_status === 'eligible'
  && current.pricing_offer_source === 'nspra_2026_finite_list'
  && current.pricing_offer_expires_at === NSPRA_2026_OFFER_EXPIRES_AT
  && current.pricing_offer_eligibility_reference === eligibilityReference
  && Number.isFinite(existingGrantedAtMs)
  && existingGrantedAtMs < expiresAtMs;
if (['paid', 'complimentary'].includes(String(current.payment_status || '').toLowerCase()) || existingAnnual || existingRenewal || current.pricing_entitlement_reason) {
  throw new Error('Refusing to overwrite an existing paid, complimentary, or protected-price account.');
}
if ((existingAnnual || existingRenewal) && existingAnnual !== existingRenewal) {
  throw new Error('Refusing to overwrite a conflicting protected pricing entitlement.');
}
const hasIndependentLock = ['pricing_lock_status', 'pricing_lock_reason', 'pricing_locked_at', 'pricing_po_status', 'pricing_po_number']
  .some((field) => current[field] !== undefined && current[field] !== null && current[field] !== '');
const hasAnyOfferState = ['pricing_offer_code', 'pricing_offer_status', 'pricing_offer_source', 'pricing_offer_granted_at', 'pricing_offer_expires_at', 'pricing_offer_eligibility_reference']
  .some((field) => current[field] !== undefined && current[field] !== null && current[field] !== '');
if (hasIndependentLock || (hasAnyOfferState && !sameFiniteRosterGrant)) {
  throw new Error('Refusing to overwrite a different protected pricing offer or independently locked entitlement.');
}
const grantedAtMs = sameFiniteRosterGrant ? existingGrantedAtMs : requestedAtMs;

const pricingPatch = {
  pricing_offer_code: NSPRA_2026_OFFER_CODE,
  pricing_offer_status: 'eligible',
  pricing_offer_source: 'nspra_2026_finite_list',
  pricing_offer_granted_at: new Date(grantedAtMs).toISOString(),
  pricing_offer_expires_at: NSPRA_2026_OFFER_EXPIRES_AT,
  pricing_offer_eligibility_reference: eligibilityReference,
};
const exactExisting = Object.entries(pricingPatch).every(([field, value]) => current[field] === value);
if (!exactExisting && requestedAtMs >= expiresAtMs) throw new Error(`NSPRA eligibility must be granted before ${NSPRA_2026_OFFER_EXPIRES_AT}.`);
if (!options.apply || exactExisting) {
  console.log(JSON.stringify({
    apply: options.apply === true,
    dryRun: options.apply !== true,
    idempotent: exactExisting,
    userId: user.id,
    email,
    districtId: current.district_id,
    offerCode: NSPRA_2026_OFFER_CODE,
    expiresAt: NSPRA_2026_OFFER_EXPIRES_AT,
  }, null, 2));
  process.exit(0);
}

const update = await fetch(`${base}/rest/v1/rpc/patch_canary_protected_app_metadata`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    p_auth_user_id: user.id,
    p_district_id: String(current.district_id),
    p_expected_customer_id: String(current.stripe_customer_id || ''),
    p_expected_app_metadata: current,
    p_patch: pricingPatch,
  }),
  cache: 'no-store',
});
if (!update.ok) throw new Error(`Unable to atomically save Canary NSPRA eligibility (${update.status}).`);
const readback = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { headers, cache: 'no-store' });
if (!readback.ok) throw new Error(`Unable to verify Canary NSPRA eligibility (${readback.status}).`);
const saved = (await readback.json()).app_metadata || {};
const verified = Object.entries(pricingPatch).every(([field, value]) => saved[field] === value);
if (!verified) throw new Error('Canary NSPRA eligibility readback did not match the requested offer.');
console.log(JSON.stringify({
  apply: true,
  userId: user.id,
  email,
  districtId: saved.district_id,
  offerCode: saved.pricing_offer_code,
  expiresAt: saved.pricing_offer_expires_at,
  readbackVerified: true,
}, null, 2));
