export function feedbackDispatchStartedAt(request) {
  const status = String(request?.status || '');
  const encodedMillis = Number(status.split(':')[1]);
  if (Number.isFinite(encodedMillis) && encodedMillis > 0) return new Date(encodedMillis);
  const createdAt = new Date(request?.created_at);
  return Number.isNaN(createdAt.getTime()) ? null : createdAt;
}

export function feedbackDispatchAgeHours(request, nowInput = new Date()) {
  const startedAt = feedbackDispatchStartedAt(request);
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  if (!startedAt || Number.isNaN(now.getTime())) return Number.POSITIVE_INFINITY;
  return (now - startedAt) / 3_600_000;
}
