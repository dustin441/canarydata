import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const SUPABASE_URL = required('CANARY_PROD_SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_KEY = required('CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY');
const N8N_URL = required('N8N_EIC_BASE_URL').replace(/\/$/, '');
const N8N_KEY = required('N8N_EIC_API_KEY');
const QUIET = process.argv.includes('--quiet');
const STATE_FILE = process.env.CANARY_HEALTH_STATE_FILE || '';
const DAY = 86_400_000;
const now = new Date();
const isoAgo = (days) => new Date(now.getTime() - days * DAY).toISOString();

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${new URL(url).pathname}`);
  return response.json();
}

async function supabase(table, params) {
  const query = new URLSearchParams(params);
  return getJson(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  });
}

const inc = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const activeWorkflowIds = ['dVIf6KnZklHYzQvi'];

const [districts, generatedQueries, searchQueries, rawResults, stories, candidates, workflowExecutions] = await Promise.all([
  supabase('districts', { select: 'id,name', limit: '1000' }),
  supabase('generated_queries', { select: 'id,district_id,query_type,query_text,search_params,active', active: 'eq.true', limit: '1000' }),
  supabase('search_queries', { select: 'id,district_id,query_text,active', active: 'eq.true', limit: '1000' }),
  supabase('raw_search_results', { select: 'generated_query_id,district_id,source_name,collected_at', collected_at: `gte.${isoAgo(14)}`, limit: '5000' }),
  supabase('news_stories', { select: 'district_id,source,created_at', created_at: `gte.${isoAgo(14)}`, limit: '5000' }),
  supabase('story_candidates', { select: 'generated_query_id,district_id,decision,evaluated_at', evaluated_at: `gte.${isoAgo(7)}`, limit: '5000' }),
  Promise.all(activeWorkflowIds.map(async (workflowId) => ({
    workflowId,
    executions: (await getJson(`${N8N_URL}/api/v1/executions?workflowId=${workflowId}&limit=20`, { 'X-N8N-API-KEY': N8N_KEY })).data || [],
  }))),
]);

const districtName = new Map(districts.map((row) => [row.id, row.name]));
const excludedDistricts = new Set(['canary-payment-test-district']);
const monitoredDistricts = new Set([...generatedQueries, ...searchQueries].map((row) => row.district_id).filter((id) => id && !excludedDistricts.has(id)));
const rawByDistrict = new Map();
const storyByDistrict = new Map();
const candidateByDistrict = new Map();
const rejectedByDistrict = new Map();
const rawByQuery = new Map();
const sourcesByDistrict = new Map();
const latestRawByDistrict = new Map();
const latestCandidateByDistrict = new Map();
const latestStoryByDistrict = new Map();
const setLatest = (map, key, value) => {
  if (!value) return;
  if (!map.has(key) || new Date(value) > new Date(map.get(key))) map.set(key, value);
};
for (const row of rawResults) {
  if (new Date(row.collected_at) >= new Date(isoAgo(7))) inc(rawByDistrict, row.district_id);
  if (row.generated_query_id) inc(rawByQuery, row.generated_query_id);
  if (!sourcesByDistrict.has(row.district_id)) sourcesByDistrict.set(row.district_id, new Set());
  if (row.source_name) sourcesByDistrict.get(row.district_id).add(String(row.source_name).toLowerCase());
  setLatest(latestRawByDistrict, row.district_id, row.collected_at);
}
for (const row of stories) {
  inc(storyByDistrict, row.district_id);
  setLatest(latestStoryByDistrict, row.district_id, row.created_at);
}
for (const row of candidates) {
  inc(candidateByDistrict, row.district_id);
  setLatest(latestCandidateByDistrict, row.district_id, row.evaluated_at);
  if (row.decision === 'rejected') inc(rejectedByDistrict, row.district_id);
}

const alerts = [];
const districtHealth = [];
const add = (severity, code, message, details = {}) => alerts.push({ severity, code, message, ...details });
for (const id of monitoredDistricts) {
  const label = districtName.get(id) || id;
  const raw = rawByDistrict.get(id) || 0;
  const acceptedStories = storyByDistrict.get(id) || 0;
  const evaluated = candidateByDistrict.get(id) || 0;
  const rejected = rejectedByDistrict.get(id) || 0;
  const lastRawAt = latestRawByDistrict.get(id) || null;
  const lastCandidateAt = latestCandidateByDistrict.get(id) || null;
  const lastStoryAt = latestStoryByDistrict.get(id) || null;
  const latestCollectionEvidence = [lastRawAt, lastCandidateAt].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
  const staleHours = latestCollectionEvidence ? (now - new Date(latestCollectionEvidence)) / 3_600_000 : null;
  if (staleHours === null || staleHours > 36) add('critical', 'district_collection_stale_36h', `${label} has no collection evidence in the last 36 hours.`, { district_id: id, latest_collection_evidence: latestCollectionEvidence });
  if (raw === 0) add('warning', 'district_zero_raw_results_7d', `${label} has no raw search results in the last 7 days.`, { district_id: id });
  if (raw > 0 && acceptedStories === 0) add('warning', 'district_zero_stories_14d', `${label} has raw results but no new accepted stories in the last 14 days.`, { district_id: id, raw_results_7d: raw });
  if (evaluated >= 10 && rejected / evaluated >= 0.9) add('warning', 'district_high_rejection_rate', `${label} rejected ${rejected}/${evaluated} evaluated candidates in the last 7 days.`, { district_id: id, rejection_rate: Number((rejected / evaluated).toFixed(3)) });
  districtHealth.push({ district_id: id, district_name: label, latest_collection_evidence: latestCollectionEvidence, latest_story_at: lastStoryAt, raw_results_7d: raw, candidates_evaluated_7d: evaluated, rejected_candidates_7d: rejected, accepted_stories_14d: acceptedStories, status: staleHours === null || staleHours > 36 ? 'critical' : raw > 0 && acceptedStories === 0 ? 'warning' : 'healthy' });
}
const missingBaselineByDistrict = new Map();
for (const query of generatedQueries) {
  const baselineQuery = ['entity_geo_topics', 'entity_local_sources', 'entity_geo_required'].includes(query.query_type);
  if (baselineQuery && (rawByQuery.get(query.id) || 0) === 0 && !excludedDistricts.has(query.district_id)) {
    if (!missingBaselineByDistrict.has(query.district_id)) missingBaselineByDistrict.set(query.district_id, []);
    missingBaselineByDistrict.get(query.district_id).push({ query_id: query.id, query_type: query.query_type });
  }
}
for (const [districtId, missing] of missingBaselineByDistrict) {
  if ((rawByDistrict.get(districtId) || 0) > 0) {
    add('warning', 'baseline_queries_zero_results_14d', `${missing.length} baseline query path(s) for ${districtName.get(districtId) || districtId} returned no raw results in 14 days.`, { district_id: districtId, missing_queries: missing });
  }
}
for (const item of workflowExecutions) {
  const successes = item.executions.filter((execution) => String(execution.status).toLowerCase() === 'success');
  const latestSuccess = successes.map((execution) => new Date(execution.stoppedAt || execution.startedAt || 0)).sort((a, b) => b - a)[0];
  const failures = item.executions.filter((execution) => {
    const failed = ['error', 'crashed', 'failed'].includes(String(execution.status).toLowerCase());
    const finished = new Date(execution.stoppedAt || execution.startedAt || 0);
    return failed && now - finished <= 3 * DAY && (!latestSuccess || finished > latestSuccess);
  });
  if (failures.length) add('critical', 'workflow_unrecovered_failure', `Canary workflow ${item.workflowId} has ${failures.length} failure(s) newer than its latest success.`, { workflow_id: item.workflowId, latest_failure: failures[0]?.stoppedAt || failures[0]?.startedAt || null, latest_success: latestSuccess?.toISOString() || null });
  if (!latestSuccess || now - latestSuccess > 36 * 3_600_000) add('critical', 'workflow_no_success_36h', `Canary workflow ${item.workflowId} has no successful execution in the last 36 hours.`, { workflow_id: item.workflowId, latest_success: latestSuccess?.toISOString() || null });
}

const status = alerts.some((alert) => alert.severity === 'critical') ? 'critical' : alerts.length ? 'warning' : 'healthy';
const rawResults7d = [...rawByDistrict.values()].reduce((sum, count) => sum + count, 0);
const report = {
  status,
  generated_at: now.toISOString(),
  summary: {
    monitored_districts: monitoredDistricts.size,
    active_generated_queries: generatedQueries.length,
    active_search_queries: searchQueries.length,
    raw_results_7d: rawResults7d,
    accepted_stories_14d: stories.length,
    candidates_evaluated_7d: candidates.length,
    alerts: alerts.length,
  },
  district_health: districtHealth.sort((a, b) => a.district_name.localeCompare(b.district_name)),
  alerts,
};
const fingerprintInput = alerts.map(({ severity, code, district_id, workflow_id }) => ({ severity, code, district_id: district_id || null, workflow_id: workflow_id || null }));
const fingerprint = createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex');
let previousFingerprint = null;
if (STATE_FILE) {
  try {
    previousFingerprint = JSON.parse(await readFile(STATE_FILE, 'utf8')).fingerprint || null;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeFile(STATE_FILE, JSON.stringify({ fingerprint, status, generated_at: report.generated_at }, null, 2));
}
const changed = !STATE_FILE || fingerprint !== previousFingerprint;
if (!QUIET || changed) console.log(JSON.stringify(report, null, 2));
