const ROUTINE_RECOMMENDATION_PATTERNS = [
  /no immediate communications action recommended/i,
  /continue routine monitoring/i,
  /no action (?:is )?needed/i,
];

function cleanText(value) {
  return String(value || '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function numericScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : 0;
}

export function isRoutineRecommendation(value) {
  const recommendation = cleanText(value);
  return Boolean(recommendation) && ROUTINE_RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(recommendation));
}

export function buildCommunicationsBrief(articles, limit = 3) {
  const records = [];
  const seen = new Set();

  for (const article of Array.isArray(articles) ? articles : []) {
    if (!article || typeof article !== 'object') continue;
    const identity = cleanText(article.link) || cleanText(article.id) || `${cleanText(article.date)}:${cleanText(article.headline)}`;
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    records.push(article);
  }

  const latestDate = records
    .map((article) => cleanText(article.date))
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0] || null;

  const recommended = records.filter((article) => cleanText(article.recommendation));
  const routineCount = recommended.filter((article) => isRoutineRecommendation(article.recommendation)).length;
  const actionable = recommended
    .filter((article) => !isRoutineRecommendation(article.recommendation))
    .sort((a, b) => {
      const dateCompare = cleanText(b.date).localeCompare(cleanText(a.date));
      if (dateCompare !== 0) return dateCompare;
      const scoreCompare = numericScore(b.canary_score) - numericScore(a.canary_score);
      if (scoreCompare !== 0) return scoreCompare;
      return cleanText(a.headline).localeCompare(cleanText(b.headline));
    });

  return {
    latestDate,
    recommendedCount: actionable.length,
    routineCount,
    items: actionable.slice(0, Math.max(0, Number(limit) || 0)),
  };
}
