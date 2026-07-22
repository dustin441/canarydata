function safeHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function cleanArray(value) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function cleanConfidence(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['high', 'medium', 'low', 'needs_review'].includes(normalized) ? normalized : 'needs_review';
}

export function buildStrategicGovernance({ districtId, profiles, priorities }) {
  const profile = (Array.isArray(profiles) ? profiles : []).find((item) => item?.district_id === districtId);
  if (!profile) return null;

  const activePriorities = (Array.isArray(priorities) ? priorities : [])
    .filter((item) => item?.district_id === districtId && item?.active !== false && (!item.profile_id || item.profile_id === profile.id))
    .map((item) => ({
      id: item.id,
      label: String(item.label || '').trim(),
      description: String(item.description || '').trim() || null,
      confidence: cleanConfidence(item.confidence),
      sourceUrls: cleanArray(item.source_urls).map(safeHttpUrl).filter(Boolean),
    }))
    .filter((item) => item.label)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));

  const sourceUrls = [...new Set([
    ...cleanArray(profile.source_urls).map(safeHttpUrl).filter(Boolean),
    ...activePriorities.flatMap((item) => item.sourceUrls),
  ])];

  return {
    profile,
    confidence: cleanConfidence(profile.source_confidence),
    mission: String(profile.mission || '').trim() || null,
    vision: String(profile.vision || '').trim() || null,
    values: cleanArray(profile.values),
    lastReviewedAt: profile.last_reviewed_at || null,
    priorities: activePriorities,
    priorityCount: activePriorities.length,
    sourceUrls,
    sourceCount: sourceUrls.length,
  };
}
