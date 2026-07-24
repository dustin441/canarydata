import { buildSocialResults } from './social.mjs';
import { canonicalTags } from './canonicalTags.mjs';

export const SOCIAL_SOURCE_TYPES = new Set(['facebook', 'instagram', 'tiktok', 'twitter', 'x', 'youtube', 'threads', 'linkedin']);

export function isNewsMediaArticle(article) {
  return !SOCIAL_SOURCE_TYPES.has(String(article?.source_type || '').toLowerCase());
}

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

export function buildReportingDataset({ articles = [], socialThreads = [] } = {}) {
  const seenMediaIds = new Set();
  const mediaArticles = articles.filter(isNewsMediaArticle).filter((article) => {
    const key = mediaRecordKey(article);
    if (seenMediaIds.has(key)) return false;
    seenMediaIds.add(key);
    return true;
  });
  const legacySocialArticles = articles.filter((article) => !isNewsMediaArticle(article));
  const socialInputsByDistrict = new Map();
  for (const record of [...socialThreads, ...legacySocialArticles]) {
    const districtId = record?.district_id || 'unscoped';
    if (!socialInputsByDistrict.has(districtId)) socialInputsByDistrict.set(districtId, []);
    socialInputsByDistrict.get(districtId).push(record);
  }
  const socialResults = Array.from(socialInputsByDistrict.values())
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
  return { records, mediaArticles, socialResults };
}

export function filterReportingDataset(dataset, { districtId = 'All', campaignSearch = '' } = {}) {
  const districtMatches = (recordDistrictId) => districtId === 'All' || recordDistrictId === districtId;
  const mediaArticles = (dataset?.mediaArticles || []).filter((article) => (
    districtMatches(article.district_id) && mediaArticleMatchesCampaign(article, campaignSearch)
  ));
  const socialResults = (dataset?.socialResults || []).filter((result) => (
    districtMatches(result.districtId) && socialResultMatchesCampaign(result, campaignSearch)
  ));
  const mediaIds = new Set(mediaArticles.map(mediaRecordKey));
  const socialIds = new Set(socialResults.map(socialRecordKey));
  const records = (dataset?.records || []).filter((record) => (
    record.kind === 'media' ? mediaIds.has(record.id) : socialIds.has(record.id)
  ));
  return { records, mediaArticles, socialResults };
}
