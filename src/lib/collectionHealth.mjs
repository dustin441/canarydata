const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function timestamp(value) {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function summarizeCollectionHealth(record = {}, nowValue = Date.now()) {
  const now = typeof nowValue === 'number' ? nowValue : new Date(nowValue).getTime();
  const lastResultAt = timestamp(record.lastResultAt);
  const lastCandidateAt = timestamp(record.lastCandidateAt);
  const lastStoryAt = timestamp(record.lastStoryAt);
  const latestActivityAt = Math.max(lastResultAt || 0, lastCandidateAt || 0) || null;
  const activityAgeHours = latestActivityAt ? Math.max(0, (now - latestActivityAt) / HOUR) : null;
  const storyAgeDays = lastStoryAt ? Math.max(0, (now - lastStoryAt) / DAY) : null;
  let status = 'healthy';
  let label = 'Collection evidence current';
  let detail = latestActivityAt ? 'Recent raw-result or candidate activity was recorded.' : 'No collection evidence is available.';

  if (!latestActivityAt || activityAgeHours > 72) {
    status = 'critical';
    label = 'Collection evidence stale';
    detail = latestActivityAt
      ? `No collection evidence in ${Math.floor(activityAgeHours / 24)} days.`
      : 'No collection evidence is available.';
  } else if (activityAgeHours > 36) {
    status = 'warning';
    label = 'Collection evidence delayed';
    detail = `Latest collection evidence is ${Math.floor(activityAgeHours)} hours old.`;
  } else if ((record.rawResults7d || 0) > 0 && (record.acceptedStories14d || 0) === 0) {
    status = 'warning';
    label = 'Collection needs review';
    detail = `${record.rawResults7d} raw results were collected, but no new stories were accepted in 14 days.`;
  }

  return {
    ...record,
    status,
    label,
    detail,
    latestActivityAt: latestActivityAt ? new Date(latestActivityAt).toISOString() : null,
    activityAgeHours,
    storyAgeDays,
  };
}

export function buildCollectionHealth({ districts = [], rawResults = [], candidates = [], stories = [], now = Date.now() } = {}) {
  const records = new Map(districts.map((district) => [district.id, {
    districtId: district.id,
    districtName: district.name,
    lastResultAt: null,
    lastCandidateAt: null,
    lastStoryAt: null,
    rawResults7d: 0,
    candidates7d: 0,
    acceptedStories14d: 0,
  }]));
  const ensure = (districtId) => {
    if (!records.has(districtId)) records.set(districtId, { districtId, districtName: districtId, lastResultAt: null, lastCandidateAt: null, lastStoryAt: null, rawResults7d: 0, candidates7d: 0, acceptedStories14d: 0 });
    return records.get(districtId);
  };
  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();
  const cutoff7d = nowMs - 7 * DAY;
  const cutoff14d = nowMs - 14 * DAY;

  for (const row of rawResults) {
    const record = ensure(row.district_id);
    const value = timestamp(row.collected_at);
    if (value && (!timestamp(record.lastResultAt) || value > timestamp(record.lastResultAt))) record.lastResultAt = row.collected_at;
    if (value && value >= cutoff7d) record.rawResults7d += 1;
  }
  for (const row of candidates) {
    const record = ensure(row.district_id);
    const value = timestamp(row.evaluated_at);
    if (value && (!timestamp(record.lastCandidateAt) || value > timestamp(record.lastCandidateAt))) record.lastCandidateAt = row.evaluated_at;
    if (value && value >= cutoff7d) record.candidates7d += 1;
  }
  for (const row of stories) {
    const record = ensure(row.district_id);
    const value = timestamp(row.created_at);
    if (value && (!timestamp(record.lastStoryAt) || value > timestamp(record.lastStoryAt))) record.lastStoryAt = row.created_at;
    if (value && value >= cutoff14d) record.acceptedStories14d += 1;
  }

  return [...records.values()].map((record) => summarizeCollectionHealth(record, nowMs));
}
