function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function textMatchesWholeSearchTerms(value, query) {
  const text = normalize(value);
  const normalizedQuery = normalize(query).trim();
  if (!normalizedQuery) return true;

  const terms = normalizedQuery.match(/[\p{L}\p{N}]+/gu) || [];
  if (!terms.length) return text.includes(normalizedQuery);

  return terms.every((term) => {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(term)}(?=$|[^\\p{L}\\p{N}])`, 'u');
    return pattern.test(text);
  });
}

export function articleMatchesSearch(article, query, noteText = '') {
  if (!String(query || '').trim()) return true;
  return [
    article?.headline,
    article?.summary,
    noteText,
    article?.recommendation,
    article?.innovation_reason,
    article?.source_query,
  ].some((value) => textMatchesWholeSearchTerms(value, query));
}
