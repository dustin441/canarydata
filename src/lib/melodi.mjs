const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'can', 'could', 'district', 'for', 'from', 'have', 'how', 'into', 'last', 'most', 'our', 'past', 'please', 'should', 'that', 'the', 'their', 'there', 'these', 'they', 'this', 'what', 'when', 'where', 'which', 'who', 'with', 'would', 'your',
]);

function questionTokens(question) {
  return [...new Set(String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9@]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token) && !/^\d+$/.test(token)))];
}

function textValue(item, fields) {
  return fields.map((field) => {
    const value = item?.[field];
    return Array.isArray(value) ? value.join(' ') : String(value || '');
  }).join(' ').toLowerCase();
}

function itemDate(item, fields) {
  for (const field of fields) {
    const date = new Date(item?.[field]);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function relevanceScore(item, tokens, weightedFields) {
  let score = 0;
  weightedFields.forEach(([field, weight]) => {
    const value = textValue(item, [field]);
    tokens.forEach((token) => {
      if (value.includes(token)) score += weight;
    });
  });
  return score;
}

function withinDays(item, dateFields, now, days) {
  const date = itemDate(item, dateFields);
  if (!date) return false;
  return date.getTime() >= now.getTime() - days * 24 * 60 * 60 * 1000;
}

function rankByRelevance(items, tokens, weightedFields, dateFields) {
  return [...items]
    .map((item) => ({ item, score: relevanceScore(item, tokens, weightedFields), date: itemDate(item, dateFields)?.getTime() || 0 }))
    .sort((a, b) => b.score - a.score || b.date - a.date)
    .map(({ item }) => item);
}

export function selectMelodiContext({ question, news = [], social = [], now = new Date(), newsLimit = 24, socialLimit = 16 }) {
  const tokens = questionTokens(question);
  const asksForThirtyDays = /(?:last|past)\s+30\s+days?|30[- ]day/i.test(String(question || ''));
  const asksForTopSocial = /\b(top|highest|best|most\s+engag(?:ed|ing))\b/i.test(String(question || '')) && /\b(social|post|facebook|instagram)\b/i.test(String(question || ''));

  const availableNews = (Array.isArray(news) ? news : []).filter((item) => !asksForThirtyDays || withinDays(item, ['date', 'created_at'], now, 30));
  const availableSocial = (Array.isArray(social) ? social : []).filter((item) => !asksForThirtyDays || withinDays(item, ['published_at', 'created_at'], now, 30));

  const rankedNews = rankByRelevance(
    availableNews,
    tokens,
    [['headline', 7], ['summary', 4], ['tags', 3], ['innovation_reason', 2], ['recommendation', 1], ['source', 1]],
    ['date', 'created_at']
  );
  const rankedSocial = asksForTopSocial
    ? [...availableSocial].sort((a, b) => Number(b?.engagement_total || 0) - Number(a?.engagement_total || 0) || (itemDate(b, ['published_at'])?.getTime() || 0) - (itemDate(a, ['published_at'])?.getTime() || 0))
    : rankByRelevance(
      availableSocial,
      tokens,
      [['headline', 7], ['body', 4], ['summary', 3], ['tags', 3], ['strategic_alignment', 2], ['recommendation', 1], ['author_name', 1]],
      ['published_at', 'created_at']
    );

  return {
    news: rankedNews.slice(0, Math.max(0, newsLimit)),
    social: rankedSocial.slice(0, Math.max(0, socialLimit)),
    appliedWindowDays: asksForThirtyDays ? 30 : null,
  };
}

export function safeMelodiSourceUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function stableMelodiCitationId(prefix, item) {
  const normalizedPrefix = ['N', 'S', 'P'].includes(String(prefix || '').toUpperCase()) ? String(prefix).toUpperCase() : 'N';
  const raw = String(item?.id || item?.canonical_url || item?.link || item?.label || item?.headline || 'record');
  let token = raw.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 12);
  if (token.length < 8) {
    let hash = 2166136261;
    for (const character of raw) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    token = `${token}${(hash >>> 0).toString(36).toUpperCase()}`.slice(0, 12);
  }
  return `${normalizedPrefix}-${token}`;
}

export function extractMelodiCitationIds(text) {
  const allowed = new Set();
  for (const match of String(text || '').matchAll(/\[((?:N|S|P)-[A-Z0-9]{4,16})\]/gi)) {
    allowed.add(match[1].toUpperCase());
  }
  return [...allowed];
}

export function validateMelodiAnswer(text, knownIds) {
  const answer = String(text || '').trim();
  const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
  const citations = extractMelodiCitationIds(answer);
  const unknownCitations = citations.filter((id) => !known.has(id));
  if (!answer) return { valid: false, reason: 'empty', citations, unknownCitations };
  if (known.size === 0) return { valid: true, reason: null, citations, unknownCitations: [] };
  if (citations.length === 0) return { valid: false, reason: 'missing-citations', citations, unknownCitations };
  if (unknownCitations.length > 0) return { valid: false, reason: 'unknown-citations', citations, unknownCitations };

  const uncitedLines = answer.split(/\n+/).map((line) => line.trim()).filter((line) => {
    if (!line || /^#{1,6}\s+/.test(line)) return false;
    const withoutMarkers = line.replace(/\[(?:N|S|P)-[A-Z0-9]{4,16}\]/gi, '').replace(/^[-*\d.)\s]+/, '').trim();
    if (withoutMarkers.length < 32 || withoutMarkers.split(/\s+/).length < 6) return false;
    if (/^(the available records|no matching records|public-social discovery|canary's public-social coverage|i cannot determine)/i.test(withoutMarkers)) return false;
    return extractMelodiCitationIds(line).length === 0;
  });
  return { valid: uncitedLines.length === 0, reason: uncitedLines.length ? 'uncited-lines' : null, citations, unknownCitations, uncitedLines };
}
