const NAVIGATION_MARKERS = [
  /skip to main content/i,
  /popular links/i,
  /staff hub/i,
  /new student registration/i,
  /site map/i,
  /sign in contents/i,
  /home our district/i,
  /close ×|× close/i,
];

function compact(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countOccurrences(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))].length;
}

export function assessDiscoveredTextQuality(value, { contentType = '' } = {}) {
  const text = compact(value);
  if (!text) return { acceptable: true, reason: null, length: 0, navigationScore: 0 };

  const navigationScore = NAVIGATION_MARKERS.reduce((sum, marker) => sum + countOccurrences(text, marker), 0);
  const htmlLike = /html/i.test(contentType);
  const repeatedMenuScore = [
    /popular links/gi,
    /staff hub/gi,
    /new student registration/gi,
    /home our district/gi,
    /school info/gi,
  ].reduce((sum, marker) => sum + countOccurrences(text, marker), 0);
  const genericMenuPattern = /\b(?:home|about(?: us)?|schools?|departments?|students?|families|staff|board|calendar|contact|employment|registration|directory|menu|search)\b/gi;
  const genericMenuMatches = [...text.matchAll(genericMenuPattern)].map((match) => match[0].toLowerCase());
  const genericMenuLabels = genericMenuMatches.length;
  const distinctGenericMenuLabels = new Set(genericMenuMatches).size;
  const punctuationCount = (text.match(/[.!?]/g) || []).length;
  const navigationDensity = genericMenuLabels / Math.max(1, text.split(/\s+/).length);
  const sentenceDensity = punctuationCount / Math.max(1, text.length);

  if (
    navigationScore >= 2
    || repeatedMenuScore >= 4
    || (htmlLike && text.length > 20_000 && navigationScore > 0)
    || (
      text.length > 100
      && genericMenuLabels >= 8
      && distinctGenericMenuLabels >= 6
      && navigationDensity > 0.35
      && sentenceDensity < 0.01
    )
  ) {
    return {
      acceptable: false,
      reason: 'The extracted text is navigation- or boilerplate-heavy and needs manual review.',
      length: text.length,
      navigationScore,
    };
  }

  return { acceptable: true, reason: null, length: text.length, navigationScore };
}

export function sanitizeStrategicDocumentText(value, { contentType = '', maxLength = 60_000 } = {}) {
  const sourceText = String(value || '').replace(/\u0000/g, '').trim();
  const quality = assessDiscoveredTextQuality(sourceText, { contentType });
  if (!quality.acceptable) return { text: '', ...quality, needsManualReview: true };
  return {
    text: sourceText.slice(0, maxLength).trim(),
    ...quality,
    needsManualReview: false,
  };
}

export function findMeaningfulSnippets(value, terms, max = 3) {
  const text = String(value || '');
  const lower = text.toLowerCase();
  const snippets = [];
  for (const term of terms) {
    let cursor = 0;
    while (snippets.length < max) {
      const idx = lower.indexOf(String(term).toLowerCase(), cursor);
      if (idx < 0) break;
      const start = Math.max(0, idx - 120);
      const end = Math.min(text.length, idx + 760);
      const snippet = compact(text.slice(start, end)).slice(0, 900).trim();
      const quality = assessDiscoveredTextQuality(snippet, { contentType: 'text/html' });
      if (snippet && quality.acceptable && !snippets.some((existing) => existing.includes(snippet.slice(0, 120)))) {
        snippets.push(snippet);
      }
      cursor = idx + String(term).length;
    }
    if (snippets.length >= max) break;
  }
  return snippets;
}

export function assertConfirmedOnboardingProfileQuality(profile = {}) {
  const fields = [
    ['mission / vision / values', profile.mission_vision_values],
    ['strategic priorities', profile.strategic_priorities],
    ['strategic plan text', profile.strategic_plan_text],
  ];
  for (const [label, value] of fields) {
    if (!String(value || '').trim()) continue;
    const quality = assessDiscoveredTextQuality(value);
    if (!quality.acceptable) {
      throw new Error(`Please clean up the ${label} field before submitting. ${quality.reason}`);
    }
  }
  return true;
}
