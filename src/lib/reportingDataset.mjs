import { buildSocialResults } from './social.mjs';
import { canonicalTags } from './canonicalTags.mjs';
import { isLegacySocialArticle, isNewsEligibleArticle } from './newsEligibility.mjs';

// Backward-compatible export for existing report/demo consumers.
export const isNewsMediaArticle = isNewsEligibleArticle;

function includesCampaign(values, campaignSearch = '') {
  const query = String(campaignSearch || '').trim().toLowerCase();
  if (!query) return true;
  return values.some((value) => String(value || '').toLowerCase().includes(query));
}

export function mediaArticleMatchesCampaign(article, campaignSearch = '') {
  return includesCampaign([
    article?.headline,
    article?.summary,
    article?.notes,
    article?.recommendation,
    article?.innovation_reason,
    article?.source_query,
    ...canonicalTags(article?.tags),
  ], campaignSearch);
}

export function socialResultMatchesCampaign(result, campaignSearch = '') {
  return includesCampaign([
    result?.headline,
    result?.summary,
    result?.authorName,
    result?.platform,
    result?.matchReason,
    result?.actionIntelligence?.actionLabel,
    result?.actionIntelligence?.recommendedAction,
    result?.actionIntelligence?.strategicAlignmentReason,
    ...(result?.actionIntelligence?.strategicPriorityLabels || []),
  ], campaignSearch);
}

function mediaRecordKey(article) {
  return `${article?.district_id || 'unscoped'}:${article?.id || `${article?.link || ''}:${article?.date || ''}`}`;
}

function socialRecordKey(result) {
  return `${result?.districtId || 'unscoped'}:${result?.id || result?.url || result?.date || ''}`;
}

export function buildReportingDataset({ articles = [], socialThreads = [], legacySocialArticles = [] } = {}) {
  const seenMediaIds = new Set();
  const mediaArticles = articles.filter(isNewsEligibleArticle).filter((article) => {
    const key = mediaRecordKey(article);
    if (seenMediaIds.has(key)) return false;
    seenMediaIds.add(key);
    return true;
  });
  const socialInputsByDistrict = new Map();
  for (const record of socialThreads) {
    const districtId = record?.district_id || 'unscoped';
    if (!socialInputsByDistrict.has(districtId)) socialInputsByDistrict.set(districtId, []);
    socialInputsByDistrict.get(districtId).push(record);
  }
  const socialResults = Array.from(socialInputsByDistrict.values())
    .flatMap((recordsForDistrict) => buildSocialResults(recordsForDistrict));

  // Legacy news_stories Social rows are supplied only to authenticated admins and
  // remain audit evidence. They never enter client Social feeds, totals, or reports.
  const legacyInputsByDistrict = new Map();
  for (const record of legacySocialArticles.filter(isLegacySocialArticle)) {
    const districtId = record?.district_id || 'unscoped';
    if (!legacyInputsByDistrict.has(districtId)) legacyInputsByDistrict.set(districtId, []);
    legacyInputsByDistrict.get(districtId).push(record);
  }
  const suppressedLegacySocialResults = Array.from(legacyInputsByDistrict.values())
    .flatMap((recordsForDistrict) => buildSocialResults(recordsForDistrict));

  const records = [
    ...mediaArticles.map((article) => ({
      kind: 'media',
      id: mediaRecordKey(article),
      districtId: article.district_id || null,
      date: article.date || article.created_at || null,
      source: article.source_type || 'other',
      raw: article,
    })),
    ...socialResults.map((result) => ({
      kind: 'social',
      id: socialRecordKey(result),
      districtId: result.districtId || null,
      date: result.date || null,
      source: result.platform || 'social',
      raw: result,
    })),
  ];
  return { records, mediaArticles, socialResults, suppressedLegacySocialResults };
}

export function filterReportingDataset(dataset, { districtId = 'All', campaignSearch = '' } = {}) {
  const districtMatches = (recordDistrictId) => districtId === 'All' || recordDistrictId === districtId;
  const mediaArticles = (dataset?.mediaArticles || []).filter((article) => (
    districtMatches(article.district_id) && mediaArticleMatchesCampaign(article, campaignSearch)
  ));
  const socialResults = (dataset?.socialResults || []).filter((result) => (
    districtMatches(result.districtId) && socialResultMatchesCampaign(result, campaignSearch)
  ));
  const suppressedLegacySocialResults = (dataset?.suppressedLegacySocialResults || []).filter((result) => (
    districtMatches(result.districtId) && socialResultMatchesCampaign(result, campaignSearch)
  ));
  const mediaIds = new Set(mediaArticles.map(mediaRecordKey));
  const socialIds = new Set(socialResults.map(socialRecordKey));
  const records = (dataset?.records || []).filter((record) => (
    record.kind === 'media' ? mediaIds.has(record.id) : socialIds.has(record.id)
  ));
  return { records, mediaArticles, socialResults, suppressedLegacySocialResults };
}
