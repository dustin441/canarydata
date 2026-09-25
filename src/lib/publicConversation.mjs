const ACTION_LABELS = {
  respond: 'Respond',
  amplify: 'Amplify',
  clarify: 'Clarify',
  thank: 'Thank',
  monitor: 'Monitor',
  elevate: 'Elevate',
  strategy: 'Strategy',
  no_action: 'No action',
};

export function normalizeCanaryScore(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 1 && score <= 10 ? score : null;
}

export function canaryScoreBand(value) {
  const score = normalizeCanaryScore(value);
  if (score === null) return 'unavailable';
  if (score >= 7) return 'positive';
  if (score >= 3) return 'neutral';
  return 'concerning';
}

export function canaryScoreBandLabel(value) {
  const labels = {
    positive: 'Positive',
    neutral: 'Neutral',
    concerning: 'Concerning',
    unavailable: 'Not scored',
  };
  return labels[canaryScoreBand(value)];
}

export function normalizeStrategicLabels(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[;|\n]/)
      : [];
  return [...new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 8);
}

export function publicConversationAction(result = {}) {
  const intelligence = result.actionIntelligence || {};
  const explicitType = String(intelligence.actionType || '').toLowerCase();
  const hasExplicitAction = Boolean(ACTION_LABELS[explicitType]);
  // Score and sentiment alone are never sufficient grounds for public engagement.
  // Until the multi-factor intelligence pipeline supplies an explicit action,
  // keep the item in review rather than recommending a response or amplification.
  const fallbackType = 'monitor';
  const actionType = hasExplicitAction ? explicitType : fallbackType;
  return {
    actionType,
    actionLabel: ACTION_LABELS[actionType],
    rationale: hasExplicitAction
      ? (intelligence.actionRationale || intelligence.recommendedAction || '')
      : 'Review the evidence and verify context before deciding whether public engagement is appropriate.',
    draftResponse: hasExplicitAction ? (intelligence.draftResponse || '') : '',
    factsToVerify: Array.isArray(intelligence.factsToVerify) ? intelligence.factsToVerify.filter(Boolean).slice(0, 8) : [],
    strategicLabels: normalizeStrategicLabels(
      intelligence.strategicPriorityLabels?.length
        ? intelligence.strategicPriorityLabels
        : result.strategicAlignment,
    ),
    strategicAlignmentReason: intelligence.strategicAlignmentReason || '',
  };
}

export function publicConversationSummary(items = []) {
  const publicItems = items.filter((item) => item.relationshipType !== 'owned');
  const scores = publicItems.map((item) => normalizeCanaryScore(item.canaryScore)).filter((score) => score !== null);
  return {
    total: publicItems.length,
    scored: scores.length,
    averageScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    positive: scores.filter((score) => score >= 7).length,
    neutral: scores.filter((score) => score >= 3 && score < 7).length,
    concerning: scores.filter((score) => score < 3).length,
    strategicHits: publicItems.filter((item) => publicConversationAction(item).strategicLabels.length > 0).length,
  };
}
