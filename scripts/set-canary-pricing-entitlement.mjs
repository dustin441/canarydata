#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { INTRODUCTORY_ANNUAL_PRICE_CENTS, PRICING_CUTOFF_AT, PRICING_POLICY_VERSION, STANDARD_ANNUAL_PRICE_CENTS } from '../src/lib/pricing.js';

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
const lockedAt = String(options['locked-at'] || '').trim();
const commitmentReference = String(options['commitment-reference'] || '').trim().slice(0, 200);
const poReference = String(options['po-reference'] || '').trim().slice(0, 200);
if (!email.includes('@') || !lockedAt || !commitmentReference || !poReference) {
  throw new Error('Usage: set-canary-pricing-entitlement.mjs --email EMAIL --locked-at ISO --commitment-reference REF --po-reference REF [--env-file PATH] [--apply]');
}
const lockedAtMs = Date.parse(lockedAt);
if (!Number.isFinite(lockedAtMs) || lockedAtMs >= Date.parse(PRICING_CUTOFF_AT)) {
  throw new Error(`The introductory lock must be documented before ${PRICING_CUTOFF_AT}.`);
}
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
if (!current.district_id) throw new Error('Refusing to set pricing without a protected Canary district owner.');
const existingAnnual = Number(current.annual_price_cents || 0);
const existingRenewal = Number(current.renewal_price_cents || 0);

const conflictingLock = current.pricing_lock_status && (
  current.pricing_lock_status !== 'approved'
  || current.pricing_lock_reason !== 'commitment_po_in_process'
  || current.pricing_entitlement_reason !== 'commitment_po_in_process'
);
if (existingAnnual === STANDARD_ANNUAL_PRICE_CENTS || existingRenewal === STANDARD_ANNUAL_PRICE_CENTS
  || current.payment_status === 'paid' || (existingAnnual && existingRenewal && existingAnnual !== existingRenewal) || conflictingLock) {
  throw new Error('Refusing to downgrade or overwrite an existing paid, standard, conflicting, or independently locked pricing entitlement.');
}
const pricingPatch = {
  annual_price_cents: INTRODUCTORY_ANNUAL_PRICE_CENTS,
  renewal_price_cents: INTRODUCTORY_ANNUAL_PRICE_CENTS,
  pricing_policy_version: PRICING_POLICY_VERSION,
  pricing_lock_status: 'approved',
  pricing_lock_reason: 'commitment_po_in_process',
  pricing_entitlement_reason: 'commitment_po_in_process',
  pricing_po_status: 'in_process',
  pricing_locked_at: new Date(lockedAtMs).toISOString(),
  pricing_commitment_reference: commitmentReference,
  pricing_po_reference: poReference,
};
const next = { ...current, ...pricingPatch };
if (!options.apply) {
  console.log(JSON.stringify({ apply: false, dryRun: true, userId: user.id, email, districtId: current.district_id || null, currentAnnualPriceCents: existingAnnual || null, proposedAnnualPriceCents: INTRODUCTORY_ANNUAL_PRICE_CENTS, lockedAt: next.pricing_locked_at, policyVersion: PRICING_POLICY_VERSION }, null, 2));
  process.exit(0);
}
const update = await fetch(`${base}/rest/v1/rpc/patch_canary_protected_app_metadata`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    p_auth_user_id: user.id,
    p_district_id: String(current.district_id || ''),
    p_expected_customer_id: String(current.stripe_customer_id || ''),
    p_expected_app_metadata: current,
    p_patch: pricingPatch,
  }),
  cache: 'no-store',
});
if (!update.ok) throw new Error(`Unable to atomically save Canary pricing entitlement (${update.status}).`);
const readback = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { headers, cache: 'no-store' });
if (!readback.ok) throw new Error(`Unable to verify Canary pricing entitlement (${readback.status}).`);
const saved = (await readback.json()).app_metadata || {};
const verified = saved.annual_price_cents === INTRODUCTORY_ANNUAL_PRICE_CENTS
  && saved.renewal_price_cents === INTRODUCTORY_ANNUAL_PRICE_CENTS
  && saved.pricing_lock_status === 'approved'
  && saved.pricing_lock_reason === 'commitment_po_in_process'
  && saved.pricing_locked_at === next.pricing_locked_at;
if (!verified) throw new Error('Canary pricing entitlement readback did not match the requested lock.');
console.log(JSON.stringify({ apply: true, userId: user.id, email, districtId: saved.district_id || null, annualPriceCents: saved.annual_price_cents, renewalPriceCents: saved.renewal_price_cents, lockedAt: saved.pricing_locked_at, policyVersion: saved.pricing_policy_version, readbackVerified: true }, null, 2));
