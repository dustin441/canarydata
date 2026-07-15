export const CORE_TAGS = Object.freeze([
  'Academic Success',
  'Engagement',
  'Innovation',
  'Operations & Finance',
  'Safety & Wellness',
]);

const CORE_TAG_SET = new Set(CORE_TAGS);

export function canonicalTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter((tag) => CORE_TAG_SET.has(tag)))];
}
