import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reconcileRecentCanaryStripePayments } from '../src/lib/payment-reconciliation.js';

const summaries = [
  { id: 'cs_paid_new', payment_status: 'paid', metadata: { user_id: 'u1', district_id: 'd1' } },
  { id: 'cs_paid_done', payment_status: 'paid', metadata: { user_id: 'u2', district_id: 'd2' } },
  { id: 'cs_paid_bad', payment_status: 'paid', metadata: { user_id: 'u3', district_id: 'd3' } },
  { id: 'cs_unpaid', payment_status: 'unpaid', metadata: { user_id: 'u4', district_id: 'd4' } },
  { id: 'cs_unowned', payment_status: 'paid', metadata: {} },
];
let cutoff;
const retrieved = [];
const result = await reconcileRecentCanaryStripePayments({
  now: new Date('2026-10-08T12:00:00Z'),
  lookbackDays: 30,
  listSessions: async ({ createdGte }) => { cutoff = createdGte; return summaries; },
  retrieveSession: async (id) => { retrieved.push(id); return { id, payment_status: 'paid' }; },
  markPaid: async ({ session }) => {
    if (session.id === 'cs_paid_bad') throw new Error('pricing mismatch');
    return { ok: true, alreadyProcessed: session.id === 'cs_paid_done' };
  },
});
assert.equal(cutoff, Math.floor(Date.parse('2026-09-08T12:00:00Z') / 1000));
assert.deepEqual(retrieved, ['cs_paid_new', 'cs_paid_done', 'cs_paid_bad']);
assert.deepEqual({ scanned: result.scanned, candidates: result.candidates, fulfilled: result.fulfilled, alreadyProcessed: result.alreadyProcessed, failed: result.failed }, {
  scanned: 5, candidates: 3, fulfilled: 1, alreadyProcessed: 1, failed: 1,
});
assert.match(result.results.find((item) => item.sessionId === 'cs_paid_bad').reason, /pricing mismatch/);

await assert.rejects(() => reconcileRecentCanaryStripePayments({ now: 'bad date', listSessions: async () => [] }), /valid reconciliation time/);
await assert.rejects(() => reconcileRecentCanaryStripePayments({ lookbackDays: 91, listSessions: async () => [] }), /between 1 and 90 days/);
const middleware = await readFile(new URL('../src/lib/supabase/middleware.js', import.meta.url), 'utf8');
assert.match(middleware, /request\.nextUrl\.pathname === ['"]\/api\/cron\/stripe-payment-reconciliation['"]/, 'the secret-protected Stripe cron route must bypass login redirects');
console.log('Stripe payment reconciliation tests passed.');
