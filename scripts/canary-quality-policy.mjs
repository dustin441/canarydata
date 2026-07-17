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
  const text = normalize([fields.headline, fields.summary, fields.recommendation, fields.risk, fields.tags].join(' '));
  return /(teacher|educator|staff|employee|principal|coach|school employee|high school employee).{0,120}(arrest|charged|charges|obscene|sexual|child|children|minor|internet crime|distribution|misconduct|investigation)|(?:arrest|charged|charges|obscene|sexual|child|children|minor|internet crime|distribution|misconduct|investigation).{0,120}(teacher|educator|staff|employee|principal|coach|school employee|high school employee)/i.test(text);
}

export function calibrateSentiment(rawSentiment, fields = {}) {
  let sentiment = Number(rawSentiment || 0);
  const text = normalize([fields.headline, fields.summary, fields.recommendation, fields.risk, fields.tags].join(' '));
  const personalIncident = /(teacher|educator|staff|employee|principal|coach).{0,80}(bac|dui|dwi|intoxicated|drunk|fatal crash|deadly crash|crash|killed|died|death|arrest|illness)|(?:bac|dui|dwi|intoxicated|drunk|fatal crash|deadly crash|crash|killed|died|death|arrest|illness).{0,80}(teacher|educator|staff|employee|principal|coach)/i.test(text);
  const griefWithoutBlame = /\b(mourns?|mourning|death|died|killed|loss of|memorial|grief)\b/i.test(text);
  const culpability = /(district|school|board|superintendent|leadership).{0,80}(neglig|cover.?up|failed|failure|fault|liable|lawsuit|sued|policy failure|supervision|student harm|under district care|public criticism|backlash|scandal)|(neglig|cover.?up|failed|failure|fault|liable|lawsuit|sued|policy failure|supervision|student harm|under district care|public criticism|backlash|scandal).{0,80}(district|school|board|superintendent|leadership)/i.test(text);
  const sensitiveTrust = detectSensitivePersonnelTrustIssue(fields);
  if (sensitiveTrust && sentiment > -0.3) sentiment = -0.7;
  if ((personalIncident || griefWithoutBlame) && !culpability && !sensitiveTrust && sentiment < -0.2) sentiment = -0.1;
  return sentiment;
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
