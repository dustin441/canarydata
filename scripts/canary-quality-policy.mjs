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
  return Boolean(source && district && source === district);
}

function isRoutineDistrictNotice(text) {
  return /\b(special board (?:of education )?meeting|board meeting notice|employment opportunities?|job openings?|registration|supply lists?|back[- ]to[- ]school|school year|sports season|calendar|schedule|reminder|public notice)\b/i.test(text);
}

function isNeutralCapitalInvestment(text) {
  const capital = /\b(capital|facilit(?:y|ies)|master plan|expansion|construction|renovation|rebuild(?:ing)?|new (?:high|middle|elementary) school|bond)\b/i.test(text);
  const controversy = /\b(backlash|critic(?:ism|iz(?:e|ed|es|ing)|al)?|concern(?:s|ed)?|controvers(?:y|ial)|opposition|protest|cost (?:overrun|increase|escalation)|over budget|delay(?:ed|s)?|behind schedule|halted|stalled|suspended|unusable|unsafe|defect(?:ive|s)?|structural damage|bankrupt(?:cy)?|contractor failure|funding gap|budget shortfall|lawsuit|litigation|fraud|investigation|tax (?:increase|burden|concern)|debt concern|voters? reject(?:ed)?|bond fail(?:ed|ure)?|defeat(?:ed)?|cancel(?:ed|led|lation)|terminated|shutdown|closure)\b/i.test(text);
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

export function classifyInstitutionalIncident(fields = {}) {
  const text = normalize([
    fields.headline, fields.summary, fields.monitoring_excerpt, fields.risk,
    fields.tags, fields.author, fields.source, fields.link,
  ].join(' '));
  const incident = /\b(death|died|dies|killed|fatal(?:ity)?|fatal crash|deadly crash|dui|dwi|intoxicated|drunk|arrest(?:ed)?|charged|misconduct|embezzl(?:e|ed|ement)|fraud|assault|abuse|crash|accident)\b/i.test(text);
  const fatalityOrDeath = /\b(death|died|dies|killed|fatal(?:ity)?|fatal crash|deadly crash)\b/i.test(text);
  const deathArrestFatality = fatalityOrDeath || /\b(arrest(?:ed)?|charged)\b/i.test(text);
  const personalContext = /\b(off[- ]duty|personal time|personal vehicle|privately owned vehicle|away from (?:school|campus)|after hours|weekend|saturday night|sunday night|not on district business)\b/i.test(text);
  const supervisedContext = /\b(school[- ]sponsored|district[- ]sponsored|field trip|under (?:district|school|staff) supervision|under (?:the )?(?:district|school)['’]s care|students? (?:were|was) in (?:the )?district care)\b/i.test(text);
  const officialCapacityEvidence = /\b(on duty|on the clock|during (?:the )?workday|district[- ]owned vehicle|school[- ]owned vehicle|district vehicle|school vehicle|school bus|district business|school business|official capacity|using district (?:funds|resources|assets|equipment)|using school (?:funds|resources|assets|equipment))\b/i.test(text);
  const officialCapacity = officialCapacityEvidence && !/\b(?:not|never) on district business\b/i.test(text);
  const documentedFailure = /\b(neglig(?:ence|ent)|cover[- ]?up|ignored safeguards?|failed safeguards?|policy failure|failure to supervise|failed to supervise|liable|liability|district fault|school fault|district misconduct|institutional failure|violated policy|knew and failed|documented failure)\b/i.test(text);
  const affirmativeStrategicActionEvidence = /\b(strengthen(?:ed|ing)? internal controls?|new internal controls?|financial controls?|audit(?:ed|ing)?|financial review process|compliance review|safeguards? implemented|policy reforms?|new oversight process)\b/i.test(text)
    && /\b(uncover(?:ed)?|discover(?:ed)?|detect(?:ed)?|identified|exposed|prevent(?:ed)?|stopped)\b/i.test(text);
  const affirmativeStrategicAction = affirmativeStrategicActionEvidence
    && !/\b(?:no|without) (?:district )?(?:audit|internal controls?|financial controls?|review process|oversight process)\b/i.test(text);
  return {
    incident,
    fatalityOrDeath,
    deathArrestFatality,
    personalContext,
    supervisedContext,
    officialCapacity,
    institutionalNexus: supervisedContext || officialCapacity,
    documentedFailure,
    affirmativeStrategicAction,
  };
}

export function shouldSuppressStrategicAlignment(context = {}) {
  if (context.deathArrestFatality) return true;
  return Boolean(context.incident && !context.affirmativeStrategicAction);
}

export function calibrateSentiment(rawSentiment, fields = {}) {
  let sentiment = Number(rawSentiment || 0);
  const text = normalize([
    fields.headline, fields.summary, fields.risk, fields.tags,
    fields.author, fields.source, fields.link,
  ].join(' '));
  const incidentContext = classifyInstitutionalIncident(fields);
  const griefWithoutBlame = /\b(mourns?|mourning|death|died|killed|loss of|memorial|grief)\b/i.test(text);
  const sourceAuthored = isSourceAuthoredContent(text);
  const districtControlled = isDistrictControlledContent(fields);
  const routineDistrictNotice = districtControlled && isRoutineDistrictNotice(text);
  const neutralCapitalInvestment = isNeutralCapitalInvestment(text);
  const proactiveTruthTelling = isProactiveTruthTelling(text);
  const sensitiveTrust = detectSensitivePersonnelTrustIssue(fields);
  if (sensitiveTrust && sentiment > -0.3) sentiment = -0.7;
  if (incidentContext.incident && incidentContext.documentedFailure) {
    sentiment = Math.min(sentiment, -0.3);
  } else if (incidentContext.incident && incidentContext.institutionalNexus) {
    // Preserve the model's evidence-based concern, but never let an official-capacity
    // incident read like a positive district achievement merely because it is relevant.
    sentiment = Math.min(sentiment, 0.1);
  } else if ((incidentContext.incident || griefWithoutBlame) && !sensitiveTrust) {
    // A district nexus establishes relevance, not blame. Personal/off-duty tragedies
    // remain neutral toward the institution unless the reporting supplies stronger facts.
    sentiment = Math.max(-0.1, Math.min(0.1, sentiment));
  }
  if (neutralCapitalInvestment && !incidentContext.documentedFailure && !sensitiveTrust && sentiment < 0) sentiment = 0;
  if (routineDistrictNotice && !incidentContext.documentedFailure && !sensitiveTrust) sentiment = 0;
  else if (districtControlled && !incidentContext.documentedFailure && !sensitiveTrust) sentiment = Math.max(-0.1, Math.min(0.25, sentiment));
  if (proactiveTruthTelling && !incidentContext.documentedFailure && !sensitiveTrust && sentiment < 0.1) sentiment = 0.1;
  if (sourceAuthored && !incidentContext.documentedFailure && !sensitiveTrust && sentiment > 0.25) sentiment = 0.25;
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

const ROUTINE_RECOMMENDATION = 'No immediate communications action recommended. Continue routine monitoring.';
const SOURCE_REVIEW_RECOMMENDATION = 'Review the source details before taking communications action.';

function recommendationString(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value)
    .map(([key, entry]) => `${key.replace(/_/g, ' ')}: ${Array.isArray(entry) ? entry.join('; ') : String(entry)}`)
    .join('\n');
}

function ensureRecommendationSentence(value) {
  const text = String(value || '').trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function capRecommendationWords(value, maxWords = 90) {
  const text = String(value || '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const kept = [];
  let count = 0;
  for (const sentence of sentences) {
    const sentenceWords = sentence.trim().split(/\s+/).filter(Boolean).length;
    if (count + sentenceWords > maxWords) break;
    kept.push(sentence.trim());
    count += sentenceWords;
  }
  if (kept.length) return kept.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}

export function normalizeRecommendationContract(value, context = {}) {
  const text = recommendationString(value).replace(/\s+/g, ' ').trim();
  if (!text || /^(n\/?a|not applicable|none|null|undefined|-)$/i.test(text)) return ROUTINE_RECOMMENDATION;
  if (/^no immediate communications action recommended\b/i.test(text)) return ROUTINE_RECOMMENDATION;
  if (/^review the source details before taking communications action\b/i.test(text)) return SOURCE_REVIEW_RECOMMENDATION;

  const completeText = capRecommendationWords(ensureRecommendationSentence(text));
  const words = completeText.split(/\s+/).filter(Boolean);
  const hasMonitoringCondition = /\b(monitor|watch|track|follow[- ]?up|material changes?|stakeholder questions?|misinformation)\b/i.test(completeText);
  if (words.length >= 18 || (words.length >= 12 && hasMonitoringCondition)) return completeText;

  const sentiment = Number(context.sentiment || 0);
  const risk = String(context.risk || context.risk_level || '').toLowerCase();
  if (risk === 'high' || risk === 'medium' || sentiment < -0.2) {
    return `${completeText} Confirm the relevant facts and responsible spokesperson before publishing, then monitor for stakeholder questions, misinformation, or material changes.`;
  }
  if (sentiment > 0.2) {
    return `${completeText} Verify the details before amplification, then monitor for stakeholder questions or follow-up opportunities.`;
  }
  return `${completeText} Confirm the relevant details before publishing, then continue monitoring for stakeholder questions or material changes.`;
}

export function normalizeArticleInterpretation(ai = {}, evidence = {}) {
  const originalSummary = String(ai.summary ?? '').trim();
  const originalRecommendation = recommendationString(ai.local_recommendation ?? ai.recommendation);
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
  recommendation = normalizeRecommendationContract(recommendation, { risk: ai.risk, sentiment });
  return { summary, recommendation, sentiment };
}

const canonical = (value) => normalize(value).replace(/^\*\*|\*\*$/g, '').replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
export function canonicalStrategicAlignment(ai, priorities = [], evidence = {}) {
  const incidentContext = classifyInstitutionalIncident(evidence);
  if (shouldSuppressStrategicAlignment(incidentContext)) {
    return { flag: false, labels: [], reason: 'N/A' };
  }
  const allowed = new Map(priorities.map((priority) => [canonical(priority.label), priority.label]));
  const proposed = String(ai.strategic_alignment || '').split('|').map((part) => canonical(part)).filter(Boolean);
  if (!proposed.length || proposed.some((part) => !allowed.has(part)) || !String(ai.alignment_explanation || '').trim()) {
    return { flag: false, labels: [], reason: 'N/A' };
  }
  const labels = [...new Set(proposed.map((part) => allowed.get(part)))].slice(0, 3);
  return { flag: true, labels, reason: `**${labels.join(' | ')}** – ${String(ai.alignment_explanation).trim()}` };
}
