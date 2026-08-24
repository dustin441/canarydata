const normalize = (value) => String(value ?? '').toLowerCase();
const asTerms = (value) => Array.isArray(value) ? value.filter(Boolean) : [];

function termMatches(haystack, term) {
  const value = normalize(term);
  if (!value) return false;
  if (/^[a-z]{2}$/.test(value)) return new RegExp(`(^|[^a-z])${value}([^a-z]|$)`, 'i').test(haystack);
  return haystack.includes(value);
}

function scoreTerms(haystack, terms, weight) {
  const matches = terms.filter((term) => termMatches(haystack, term));
  return { score: matches.length * weight, matches };
}

export function validateCandidate(row) {
  const profile = row.profile || {};
  const entities = row.entities || [];
  const haystack = normalize([
    row.title, row.snippet, row.source_name, row.url,
    row.raw_payload?.title, row.raw_payload?.snippet, row.raw_payload?.source?.name,
  ].join(' '));
  const entityTerms = entities.flatMap((entity) => [entity.name, ...asTerms(entity.aliases)]);
  const requiredTerms = entities.filter((entity) => entity.required).flatMap((entity) => [entity.name, ...asTerms(entity.aliases)]);
  const entity = scoreTerms(haystack, entityTerms, 2);
  const required = scoreTerms(haystack, requiredTerms, 3);
  const geo = scoreTerms(haystack, [
    profile.primary_city, profile.state_full, profile.state_abbrev,
    profile.county_name && profile.state_abbrev ? `${profile.county_name}, ${profile.state_abbrev}` : null,
    ...asTerms(profile.zip_codes), ...asTerms(profile.nearby_cities),
    ...asTerms(profile.include_geo_terms), ...asTerms(profile.trusted_sources),
  ].filter(Boolean), 2);
  const exclusions = scoreTerms(haystack, [...asTerms(profile.exclude_geo_terms), ...asTerms(profile.blocked_sources)], 5);
  let decision = 'needs_review';
  if (exclusions.score > 0 || required.matches.length === 0) decision = 'rejected';
  else if (required.matches.length > 0 && geo.matches.length > 0) decision = 'accepted';
  return {
    decision,
    relevance_score: entity.score + required.score + geo.score - exclusions.score,
    entity_matches: entity.matches,
    required_entity_matches: required.matches,
    geo_matches: geo.matches,
    exclusion_matches: exclusions.matches,
  };
}

const STATIC_CONTENT = /\b(roster|schedule|rankings?|standings|staff directory|jobs?|employment|apartments?|rentals?|live stream|watch live)\b/i;
const EDITORIAL_SPORTS = /\b(wins?|won|defeats?|beat|advances?|captures?|claims?|championship|champion|title|semifinal|finals?|tournament|playoff|record-breaking)\b/i;
const STATIC_PATH = /\/(roster|schedule|rankings?|standings|team)(\/|$)|[?&](?:view|tab)=(?:roster|schedule|rankings?)/i;
const EDITORIAL_PATH = /\/news\//i;

export function classifySource(candidate) {
  const title = String(candidate.title || '');
  const snippet = String(candidate.snippet || '');
  const url = String(candidate.url || candidate.link || '');
  const source = String(candidate.source_name || candidate.source || '');
  const text = [title, snippet, url, source].join(' ');
  const staticDomain = /(?:nfhsnetwork|maxpreps)\.com/i.test(text);
  const editorial = EDITORIAL_PATH.test(url) || (EDITORIAL_SPORTS.test(title) && !STATIC_CONTENT.test(title));
  if (/nfhsnetwork\.com/i.test(url)) {
    return EDITORIAL_PATH.test(url)
      ? { decision: 'accept', reason: 'editorial_sports_reporting' }
      : { decision: 'reject', reason: 'static_or_stream_page' };
  }
  if (/maxpreps\.com/i.test(url) && (STATIC_PATH.test(url) || STATIC_CONTENT.test(title)) && !editorial) return { decision: 'reject', reason: 'static_sports_page' };
  if (STATIC_CONTENT.test(title) && !editorial) return { decision: 'reject', reason: 'static_or_non_news_content' };
  if (staticDomain && !editorial) return { decision: 'reject', reason: 'static_sports_page' };
  return { decision: 'accept', reason: editorial && staticDomain ? 'editorial_sports_reporting' : 'eligible_news' };
}

export function detectSensitivePersonnelTrustIssue(fields = {}) {
  // Generic recommendations can mention staff, children, privacy, or investigations.
  // Those instructions are not evidence that the underlying story is a trust incident.
  const text = normalize([fields.headline, fields.summary, fields.risk, fields.tags].join(' '));
  return /(teacher|educator|staff|employee|principal|coach|school employee|high school employee).{0,120}(arrest|charged|charges|obscene|sexual|child|children|minor|internet crime|distribution|misconduct|investigation)|(?:arrest|charged|charges|obscene|sexual|child|children|minor|internet crime|distribution|misconduct|investigation).{0,120}(teacher|educator|staff|employee|principal|coach|school employee|high school employee)/i.test(text);
}

function organizationKey(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function isDistrictControlledContent(fields = {}) {
  const source = organizationKey(fields.source);
  const district = organizationKey(fields.district_name || fields.districtName || fields.district_id || fields.districtId);
  return Boolean(source && district && (source === district || source.includes(district) || district.includes(source)));
}

function isRoutineDistrictNotice(text) {
  return /\b(special board (?:of education )?meeting|board meeting notice|employment opportunities?|job openings?|registration|supply lists?|back[- ]to[- ]school|school year|sports season|calendar|schedule|reminder|public notice)\b/i.test(text);
}

function isNeutralCapitalInvestment(text) {
  const capital = /\b(capital|facilit(?:y|ies)|master plan|expansion|construction|renovation|rebuild(?:ing)?|new (?:high|middle|elementary) school|bond)\b/i.test(text);
  const controversy = /\b(backlash|criticism|controversy|opposition|cost overrun|over budget|delay|lawsuit|tax increase|debt concern|voters? reject|bond fail|defeat)\b/i.test(text);
  const affirmativeOutcome = /\b(bond|measure|referendum)\b.{0,60}\b(passed|approved|won|voter approval)\b|\b(passed|approved|won)\b.{0,60}\b(bond|measure|referendum)\b/i.test(text);
  return capital && !controversy && !affirmativeOutcome;
}

function isSourceAuthoredContent(text) {
  return /\b(superintendent|district|school board)(?:['’]s)?\s+(?:column|op[- ]?ed)\b|\b(?:column|op[- ]?ed)\b.{0,80}\b(superintendent|district|school board)\b/i.test(text);
}

function isProactiveTruthTelling(text) {
  return /\b(news conference|press conference|public statement|column|op[- ]?ed|explains?|warns?|advocat(?:e|es|ed|ing)|communicat(?:e|es|ed|ing)|transparent|transparency)\b/i.test(text)
    && /\b(budget|funding|fiscal|legislation|financial|revenue|deficit|costs?|property tax)\b/i.test(text);
}

export function calibrateSentiment(rawSentiment, fields = {}) {
  let sentiment = Number(rawSentiment || 0);
  const text = normalize([
    fields.headline, fields.summary, fields.risk, fields.tags,
    fields.author, fields.source, fields.link,
  ].join(' '));
  const personalIncident = /(teacher|educator|staff|employee|principal|coach).{0,80}(bac|dui|dwi|intoxicated|drunk|fatal crash|deadly crash|crash|killed|died|death|arrest|illness)|(?:bac|dui|dwi|intoxicated|drunk|fatal crash|deadly crash|crash|killed|died|death|arrest|illness).{0,80}(teacher|educator|staff|employee|principal|coach)/i.test(text);
  const griefWithoutBlame = /\b(mourns?|mourning|death|died|killed|loss of|memorial|grief)\b/i.test(text);
  const culpability = /(district|school|board|superintendent|leadership).{0,80}(neglig|cover.?up|failed|failure|fault|liable|lawsuit|sued|policy failure|supervision|student harm|under district care|public criticism|backlash|scandal)|(neglig|cover.?up|failed|failure|fault|liable|lawsuit|sued|policy failure|supervision|student harm|under district care|public criticism|backlash|scandal).{0,80}(district|school|board|superintendent|leadership)/i.test(text);
  const sourceAuthored = isSourceAuthoredContent(text);
  const districtControlled = isDistrictControlledContent(fields);
  const routineDistrictNotice = districtControlled && isRoutineDistrictNotice(text);
  const neutralCapitalInvestment = isNeutralCapitalInvestment(text);
  const proactiveTruthTelling = isProactiveTruthTelling(text);
  const sensitiveTrust = detectSensitivePersonnelTrustIssue(fields);
  if (sensitiveTrust && sentiment > -0.3) sentiment = -0.7;
  if ((personalIncident || griefWithoutBlame) && !culpability && !sensitiveTrust) {
    sentiment = Math.max(-0.1, Math.min(0.1, sentiment));
  }
  if (neutralCapitalInvestment && !culpability && !sensitiveTrust && sentiment < 0) sentiment = 0;
  if (routineDistrictNotice && !culpability && !sensitiveTrust) sentiment = 0;
  else if (districtControlled && !culpability && !sensitiveTrust) sentiment = Math.max(-0.1, Math.min(0.25, sentiment));
  if (proactiveTruthTelling && !culpability && !sensitiveTrust && sentiment < 0.1) sentiment = 0.1;
  if (sourceAuthored && !culpability && !sensitiveTrust && sentiment > 0.25) sentiment = 0.25;
  return sentiment;
}

const ACCESS_LIMITATION_CLAIM = /\b(paywall(?:ed)?|behind (?:a )?paywall|article (?:content )?(?:provided )?is incomplete|incomplete article|full article (?:text|content)|article (?:is )?truncated|truncated article|content (?:is )?unavailable|await (?:the )?(?:full )?article|monitor for full article)\b/i;

function deterministicSentimentFallback(fields = {}) {
  const text = normalize([fields.headline, fields.summary, fields.monitoring_excerpt].join(' '));
  const positive = /\b(achievement|award|improv(?:e|ed|ement)|increase|growth|success|successful|launch(?:ed)?|creative|innovation|innovative|partnership|opportunity|proactive|transparent|transparency|responsib(?:le|ility)|savings?|surplus|graduation)\b/i.test(text);
  const negative = /\b(backlash|criticism|controversy|lawsuit|negligence|failure|failed|unsafe|harm|arrest|misconduct|decline|deficit|shortage|disruption|closure|cuts?)\b/i.test(text);
  if (positive && !negative) return 0.25;
  if (negative && !positive) return -0.25;
  return 0;
}

export function normalizeArticleInterpretation(ai = {}, evidence = {}) {
  const originalSummary = String(ai.summary ?? '').trim();
  const originalRecommendation = String(ai.local_recommendation ?? ai.recommendation ?? '').trim();
  const monitoringExcerpt = String(evidence.monitoring_excerpt ?? evidence.snippet ?? '').trim();
  const summary = ACCESS_LIMITATION_CLAIM.test(originalSummary) && monitoringExcerpt
    ? monitoringExcerpt
    : originalSummary;
  const isBlankRecommendation = (value) => !String(value ?? '').trim()
    || /^(n\/?a|not applicable|none|null|undefined|-)$/i.test(String(value).trim());
  let recommendation = ACCESS_LIMITATION_CLAIM.test(originalSummary) || ACCESS_LIMITATION_CLAIM.test(originalRecommendation)
    ? 'Review the source details before taking communications action.'
    : (isBlankRecommendation(originalRecommendation)
      ? 'No immediate communications action recommended. Continue routine monitoring.'
      : originalRecommendation);
  const interpretationText = normalize([
    evidence.headline, summary, monitoringExcerpt, evidence.author, evidence.source, evidence.link,
  ].join(' '));
  const repeatsDeliveredTransparency = /\b(prepare|issue|hold|publish|write|create|communicate|explain|provide)\b.{0,100}\b(statement|press conference|news conference|column|op[- ]?ed|budget|funding|fiscal|legislation|transparent|transparency)\b/i.test(originalRecommendation);
  if (isProactiveTruthTelling(interpretationText) && repeatsDeliveredTransparency) {
    recommendation = "Amplify the district's existing transparent communication and monitor stakeholder understanding; do not recommend repeating actions already documented in the story.";
  }
  const hasSentiment = ai.sentiment !== null
    && ai.sentiment !== undefined
    && String(ai.sentiment).trim() !== ''
    && Number.isFinite(Number(ai.sentiment));
  const rawSentiment = hasSentiment
    ? Number(ai.sentiment)
    : deterministicSentimentFallback({ ...evidence, summary });
  const sentiment = calibrateSentiment(rawSentiment, {
    ...evidence,
    summary,
    recommendation,
  });
  return { summary, recommendation, sentiment };
}

const canonical = (value) => normalize(value).replace(/^\*\*|\*\*$/g, '').replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
export function canonicalStrategicAlignment(ai, priorities = []) {
  const allowed = new Map(priorities.map((priority) => [canonical(priority.label), priority.label]));
  const proposed = String(ai.strategic_alignment || '').split('|').map((part) => canonical(part)).filter(Boolean);
  if (!proposed.length || proposed.some((part) => !allowed.has(part)) || !String(ai.alignment_explanation || '').trim()) {
    return { flag: false, labels: [], reason: 'N/A' };
  }
  const labels = [...new Set(proposed.map((part) => allowed.get(part)))].slice(0, 3);
  return { flag: true, labels, reason: `**${labels.join(' | ')}** – ${String(ai.alignment_explanation).trim()}` };
}
