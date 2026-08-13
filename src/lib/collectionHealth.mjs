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

export function summarizeSocialCollectionHealth(record = {}, nowValue = Date.now()) {
  const now = typeof nowValue === 'number' ? nowValue : new Date(nowValue).getTime();
  if (!record.enrolled) {
    return {
      ...record,
      status: 'not_enrolled',
      label: 'Public Social not enrolled',
      detail: 'No active Public Social discovery query is configured for this district.',
      latestActivityAt: null,
      activityAgeHours: null,
    };
  }

  const latestRunAt = timestamp(record.latestRunAt);
  const activityAgeHours = latestRunAt ? Math.max(0, (now - latestRunAt) / HOUR) : null;
  let status = 'healthy';
  let label = record.latestRunStatus === 'empty' ? 'Public Social checked, no eligible posts' : 'Public Social collection current';
  let detail = record.latestRunStatus === 'empty'
    ? 'The latest run completed normally and found no posts that passed Canary’s relevance and safety filters.'
    : 'The latest Public Social run completed normally.';

  if (!latestRunAt || activityAgeHours > 96) {
    status = 'critical';
    label = 'Public Social collection stale';
    detail = latestRunAt
      ? `No terminal Public Social run in ${Math.floor(activityAgeHours / 24)} days.`
      : 'No terminal Public Social run is available for this enrolled district.';
  } else if (record.nonterminalRunCount > 0) {
    status = 'critical';
    label = 'Public Social run did not terminalize';
    detail = `${record.nonterminalRunCount} Public Social run${record.nonterminalRunCount === 1 ? '' : 's'} remain nonterminal.`;
  } else if (record.latestRunStatus === 'failed') {
    status = 'critical';
    label = 'Public Social collection failed';
    detail = record.latestRunError
      ? `The latest Public Social run failed: ${record.latestRunError}.`
      : 'The latest Public Social run failed.';
  } else if (record.latestRunStatus === 'partial') {
    status = 'warning';
    label = 'Public Social collection partial';
    detail = record.latestRunError
      ? `The latest Public Social run completed partially: ${record.latestRunError}.`
      : 'The latest Public Social run completed only partially.';
  } else if (!['success', 'empty'].includes(record.latestRunStatus)) {
    status = 'critical';
    label = 'Public Social status unrecognized';
    detail = `The latest Public Social run has unsupported terminal status: ${record.latestRunStatus || 'missing'}.`;
  } else if (activityAgeHours > 72) {
    status = 'warning';
    label = 'Public Social collection delayed';
    detail = `Latest terminal Public Social run is ${Math.floor(activityAgeHours)} hours old.`;
  }

  return {
    ...record,
    status,
    label,
    detail,
    latestActivityAt: latestRunAt ? new Date(latestRunAt).toISOString() : null,
    activityAgeHours,
  };
}

export function buildSocialCollectionHealth({ districts = [], socialQueries = [], socialRuns = [], socialAccounts = [], now = Date.now() } = {}) {
  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();
  const nonterminalGraceMs = 4 * HOUR;
  const enrolled = new Set(socialQueries.filter((query) => query.active !== false && query.channels === 'social').map((query) => query.district_id));
  const emptyRecord = (districtId, districtName = districtId) => ({
    districtId,
    districtName,
    enrolled: enrolled.has(districtId),
    officialAccountCount: 0,
    latestRunAt: null,
    latestRunStartedAt: null,
    latestRunId: null,
    latestRunStatus: null,
    latestRunError: null,
    latestRawItems: 0,
    latestAcceptedCandidates: 0,
    nonterminalRunCount: 0,
  });
  const records = new Map(districts.map((district) => [district.id, emptyRecord(district.id, district.name)]));
  const ensure = (districtId) => {
    if (!records.has(districtId)) records.set(districtId, emptyRecord(districtId));
    return records.get(districtId);
  };

  for (const account of socialAccounts) {
    if (account.active !== false) ensure(account.district_id).officialAccountCount += 1;
  }
  for (const run of socialRuns) {
    const record = ensure(run.district_id);
    const startedAt = timestamp(run.started_at);
    const unfinished = !run.completed_at || run.status === 'running';
    if (unfinished && startedAt && nowMs - startedAt > nonterminalGraceMs) record.nonterminalRunCount += 1;
    if (unfinished) continue;
    const terminalAt = run.completed_at;
    const chronologyTime = startedAt || timestamp(terminalAt);
    const currentChronologyTime = timestamp(record.latestRunStartedAt) || timestamp(record.latestRunAt);
    const runId = String(run.id || '');
    const isLaterRun = chronologyTime && (
      !currentChronologyTime
      || chronologyTime > currentChronologyTime
      || (chronologyTime === currentChronologyTime && runId.localeCompare(String(record.latestRunId || '')) > 0)
    );
    if (isLaterRun) {
      record.latestRunAt = terminalAt;
      record.latestRunStartedAt = run.started_at || terminalAt;
      record.latestRunId = run.id || null;
      record.latestRunStatus = run.status;
      record.latestRunError = run.error_code || null;
      record.latestRawItems = Number(run.raw_items || 0);
      record.latestAcceptedCandidates = Number(run.accepted_threads || 0);
    }
  }

  return [...records.values()].map((record) => summarizeSocialCollectionHealth(record, nowMs));
}
