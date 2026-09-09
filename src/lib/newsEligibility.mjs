export const LEGACY_SOCIAL_SOURCE_TYPES = new Set([
  'facebook',
  'instagram',
  'linkedin',
  'social',
  'social media',
  'threads',
  'tiktok',
  'twitter',
  'x',
  'x/twitter',
  'youtube',
]);

export function normalizeNewsSourceType(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isLegacySocialArticle(article) {
  return LEGACY_SOCIAL_SOURCE_TYPES.has(normalizeNewsSourceType(article?.source_type));
}

// News eligibility is intentionally a Social denylist rather than source_type=news.
// Legitimate manual and other non-Social News records remain eligible.
export function isNewsEligibleArticle(article) {
  return !isLegacySocialArticle(article);
}
