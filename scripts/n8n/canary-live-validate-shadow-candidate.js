
function normalized(value) {
  return String(value || '').toLowerCase();
}
function scoreTerms(haystack, terms, weight = 1) {
  const matches = terms.filter((term) => termMatches(haystack, term));
  return { score: matches.length * weight, matches };
}
function scoreExclusionTerms(haystack, terms, weight = 1) {
  // Standalone two-letter state codes such as IN, OR, ID, and CO are also
  // ordinary words or abbreviations. Full state/city/source terms provide
  // deterministic negative geography without rejecting valid local stories.
  const contextualTerms = terms.filter((term) => !/^[a-z]{2}$/i.test(String(term || '').trim()));
  return scoreTerms(haystack, contextualTerms, weight);
}
function asTerms(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}
function termMatches(haystack, term) {
  const normalizedTerm = normalized(term);
  if (!normalizedTerm) return false;
  if (/^[a-z]{2}$/.test(normalizedTerm)) {
    return new RegExp('(^|[^a-z])' + normalizedTerm + '([^a-z]|$)', 'i').test(haystack);
  }
  return haystack.includes(normalizedTerm);
}

return $input.all().map((item) => {
  const row = item.json;
  const profile = row.profile || {};
  const entities = row.entities || [];
  const haystack = normalized([
    row.title, row.snippet, row.source_name, row.url,
    row.raw_payload?.title, row.raw_payload?.snippet, row.raw_payload?.source?.name,
  ].join(' '));

  const entityTerms = entities.flatMap((e) => [e.name, ...asTerms(e.aliases)]);
  const requiredEntityTerms = entities.filter((e) => e.required).flatMap((e) => [e.name, ...asTerms(e.aliases)]);

  const entity = scoreTerms(haystack, entityTerms, 2);
  const requiredEntity = scoreTerms(haystack, requiredEntityTerms, 3);
  const geo = scoreTerms(haystack, [
    profile.primary_city, profile.state_full, profile.state_abbrev,
    profile.county_name ? profile.county_name + ', ' + profile.state_abbrev : null,
    ...asTerms(profile.zip_codes), ...asTerms(profile.nearby_cities),
    ...asTerms(profile.include_geo_terms), ...asTerms(profile.trusted_sources),
  ], 2);
  const geoExclusions = scoreExclusionTerms(haystack, asTerms(profile.exclude_geo_terms), 5);
  // Blocked-source checks are evaluated only against source metadata. This keeps
  // explicitly configured short source names enforceable without scanning common
  // two-letter words across the headline and snippet.
  const blockedSources = scoreTerms(
    normalized([row.source_name, row.source_type, row.url].filter(Boolean).join(' ')),
    asTerms(profile.blocked_sources),
    5,
  );
  const exclusions = {
    score: geoExclusions.score + blockedSources.score,
    matches: [...geoExclusions.matches, ...blockedSources.matches],
  };

  const entityMatchScore = entity.score + requiredEntity.score;
  const geoMatchScore = geo.score;
  const exclusionScore = exclusions.score;
  const relevanceScore = entityMatchScore + geoMatchScore - exclusionScore;
  const newsLaneNonNewsPlatform = /(?:youtube\.com|youtu\.be)\//i.test(String(row.url || row.raw_payload?.link || row.raw_payload?.url || ''));

  let decision = 'needs_review';
  let decisionReason = 'Needs manual review: entity or geo evidence is weak.';
  if (newsLaneNonNewsPlatform) {
    decision = 'rejected';
    decisionReason = 'Rejected: YouTube content belongs in the Social monitoring lane, not News.';
  } else if (exclusionScore > 0) {
    decision = 'rejected';
    decisionReason = 'Rejected by exclusion match: ' + exclusions.matches.join(', ');
  } else if (requiredEntity.matches.length > 0 && geo.matches.length > 0) {
    decision = 'accepted';
    decisionReason = 'Accepted: required entity and geo evidence matched.';
  } else if (requiredEntity.matches.length === 0) {
    decision = 'rejected';
    decisionReason = 'Rejected: no required district entity matched.';
  }

  return {
    json: {
      raw_result_id: row.raw_result_id || row.id,
      generated_query_id: row.generated_query_id,
      district_id: row.district_id,
      entity_match_score: entityMatchScore,
      geo_match_score: geoMatchScore,
      exclusion_score: exclusionScore,
      relevance_score: relevanceScore,
      decision,
      decision_reason: decisionReason,
      validation_details: {
        entity_matches: entity.matches,
        required_entity_matches: requiredEntity.matches,
        geo_matches: geo.matches,
        exclusion_matches: exclusions.matches,
      },
    },
  };
});
