const DEFAULT_LOOKBACK_DAYS = 30;

export async function reconcileRecentCanaryStripePayments({
  now = new Date(),
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  listSessions,
  retrieveSession,
  markPaid,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (!Number.isFinite(nowMs)) throw new Error('A valid reconciliation time is required.');
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 90) {
    throw new Error('Stripe payment reconciliation lookback must be between 1 and 90 days.');
  }
  if (![listSessions, retrieveSession, markPaid].every((dependency) => typeof dependency === 'function')) {
    throw new Error('Stripe payment reconciliation dependencies are required.');
  }

  const createdGte = Math.floor((nowMs - lookbackDays * 86400000) / 1000);
  const summaries = await listSessions({ createdGte });
  const candidates = summaries.filter((session) => session?.payment_status === 'paid'
    && session?.metadata?.user_id
    && session?.metadata?.district_id);
  const results = [];

  for (const summary of candidates) {
    try {
      const session = await retrieveSession(summary.id);
      const result = await markPaid({ session });
      if (!result?.ok) throw new Error(result?.reason || 'payment_not_fulfilled');
      results.push({ sessionId: summary.id, ok: true, alreadyProcessed: Boolean(result.alreadyProcessed) });
    } catch (error) {
      results.push({ sessionId: summary.id, ok: false, reason: error?.message || 'reconciliation_failed' });
    }
  }

  return {
    scanned: summaries.length,
    candidates: candidates.length,
    fulfilled: results.filter((result) => result.ok && !result.alreadyProcessed).length,
    alreadyProcessed: results.filter((result) => result.ok && result.alreadyProcessed).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}
