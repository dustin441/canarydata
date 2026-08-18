#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') out.apply = true;
    else if (argv[i] === '--env-file') out.envFile = argv[++i];
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
await loadEnv(options.envFile);
const supabaseUrl = String(process.env.CANARY_PROD_SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY || '';
const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.CANARY_STRIPE_SECRET_KEY || '';
if (!supabaseUrl || !serviceKey || !stripeKey) throw new Error('Canonical Canary Supabase and Stripe credentials are required.');
const authHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const stripeHeaders = { Authorization: `Bearer ${stripeKey}` };
const users = [];
let exhausted = false;
for (let page = 1; page <= 50; page += 1) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=100`, { headers: authHeaders, cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to list Canary Auth users (${response.status}).`);
  const batch = (await response.json()).users || [];
  users.push(...batch);
  if (batch.length < 100) { exhausted = true; break; }
}
if (!exhausted) throw new Error('Canary Auth pagination reached the 5,000-user safety cap before exhaustion.');
const usersByCustomer = new Map();
for (const user of users) {
  const customerId = String(user.app_metadata?.stripe_customer_id || '');
  if (!customerId) continue;
  const linked = usersByCustomer.get(customerId) || [];
  linked.push(user.id);
  usersByCustomer.set(customerId, linked);
}
const duplicateLinks = [...usersByCustomer.entries()].filter(([, ids]) => ids.length !== 1);
if (duplicateLinks.length) throw new Error(`Duplicate protected Stripe Customer links detected: ${duplicateLinks.map(([id]) => id).join(', ')}`);
const proposals = [];
for (const user of users) {
  const customerId = user.app_metadata?.stripe_customer_id;
  if (!customerId) continue;
  const response = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, { headers: stripeHeaders, cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load a linked Stripe customer (${response.status}).`);
  const customer = await response.json();
  const expectedEmail = String(user.email || '').trim().toLowerCase();
  const customerEmail = String(customer.email || '').trim().toLowerCase();
  const owner = String(customer.metadata?.user_id || '');
  const district = String(customer.metadata?.district_id || '');
  const expectedDistrict = String(user.app_metadata?.district_id || '');
  if (!expectedDistrict) throw new Error('A linked Canary Auth user is missing its protected district owner.');
  if (customer.deleted || !expectedEmail || customerEmail !== expectedEmail) throw new Error('A linked Stripe customer does not match its protected Canary Auth email.');
  if (owner && owner !== user.id) throw new Error('A linked Stripe customer is owned by a different Canary Auth user.');
  if (district && district !== expectedDistrict) throw new Error('A linked Stripe customer has a conflicting Canary district owner.');
  if (owner !== user.id || district !== expectedDistrict) proposals.push({ user, customerId, expectedDistrict });
}
if (!options.apply) {
  console.log(JSON.stringify({ apply: false, dryRun: true, linkedCustomers: users.filter((user) => user.app_metadata?.stripe_customer_id).length, proposedUpdates: proposals.length, conflicts: 0 }, null, 2));
  process.exit(0);
}
let verified = 0;
for (const proposal of proposals) {
  const before = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(proposal.customerId)}`, { headers: stripeHeaders, cache: 'no-store' });
  if (!before.ok) throw new Error(`Unable to re-check Stripe customer ownership (${before.status}).`);
  const current = await before.json();
  const currentOwner = String(current.metadata?.user_id || '');
  const currentDistrict = String(current.metadata?.district_id || '');
  if ((currentOwner && currentOwner !== proposal.user.id) || (currentDistrict && currentDistrict !== proposal.expectedDistrict)) {
    throw new Error('Stripe customer ownership changed after dry-run discovery; refusing mutation.');
  }
  const body = new URLSearchParams({ 'metadata[user_id]': proposal.user.id, 'metadata[district_id]': proposal.expectedDistrict });
  const update = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(proposal.customerId)}`, { method: 'POST', headers: { ...stripeHeaders, 'Content-Type': 'application/x-www-form-urlencoded' }, body, cache: 'no-store' });
  if (!update.ok) throw new Error(`Unable to apply Stripe customer ownership (${update.status}).`);
  const readback = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(proposal.customerId)}`, { headers: stripeHeaders, cache: 'no-store' });
  if (!readback.ok) throw new Error(`Unable to verify Stripe customer ownership (${readback.status}).`);
  const saved = await readback.json();
  if (saved.metadata?.user_id !== proposal.user.id || String(saved.metadata?.district_id || '') !== proposal.expectedDistrict) {
    throw new Error('Stripe customer ownership readback did not match its protected Canary Auth owner.');
  }
  verified += 1;
}
console.log(JSON.stringify({ apply: true, updated: proposals.length, readbackVerified: verified, conflicts: 0 }, null, 2));
