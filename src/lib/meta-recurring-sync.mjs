import { createHash, timingSafeEqual } from 'node:crypto';

const HOUR_MS = 60 * 60 * 1000;

export function isAuthorizedCronRequest(authorization, secret) {
  if (typeof secret !== 'string' || secret.length === 0 || typeof authorization !== 'string') return false;
  const actual = createHash('sha256').update(authorization, 'utf8').digest();
  const expected = createHash('sha256').update(`Bearer ${secret}`, 'utf8').digest();
  return timingSafeEqual(actual, expected);
}

export function recurringMetaSyncDecision(latestRun, now = new Date()) {
  if (!latestRun || !latestRun.completed_at) return { run: true };
  const completedAt = new Date(latestRun.completed_at);
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(completedAt.getTime()) || Number.isNaN(nowDate.getTime())) return { run: true };
  const ageMs = nowDate.getTime() - completedAt.getTime();
  if (ageMs < 0) return { run: true };
  if (['success', 'empty'].includes(latestRun.status) && ageMs < 20 * HOUR_MS) {
    return { run: false, reason: 'healthy_cadence' };
  }
  if (latestRun.status === 'partial'
    && (!latestRun.next_cursor || Object.keys(latestRun.next_cursor).length === 0)
    && ageMs < 20 * HOUR_MS) {
    return { run: false, reason: 'partial_without_continuation' };
  }
  if (latestRun.status === 'failed' && ageMs < 15 * 60 * 1000) {
    return { run: false, reason: 'failure_cooldown' };
  }
  return { run: true };
}

function safeCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

export function sanitizeMetaSyncResult(result) {
  const allowedStatuses = new Set(['success', 'empty', 'partial', 'failed', 'skipped']);
  return {
    status: allowedStatuses.has(result?.status) ? result.status : 'partial',
    counts: {
      accountsAttempted: safeCount(result?.accountsAttempted),
      accountsSucceeded: safeCount(result?.accountsSucceeded),
      postsRead: safeCount(result?.postsRead),
      rejectedItems: safeCount(result?.rejectedItems),
      providerErrors: safeCount(result?.providerErrors),
      duplicateItems: safeCount(result?.duplicateItems),
      metricRowsWritten: safeCount(result?.metricRowsWritten),
    },
    continuation: result?.continuationRequired === true,
  };
}
