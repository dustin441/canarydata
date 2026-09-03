
function getPath(value, path) {
  return path.reduce((current, key) => current == null ? undefined : current[key], value);
}
function extractAiText(json) {
  const candidates = [
    json.text, json.output_text, json.output, json.response,
    json.completion, json.message, json.content, json.mergedResponse, json.merged_response,
    getPath(json, ['output', 0, 'content', 0, 'text']),
    getPath(json, ['content', 0, 'text']),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (Array.isArray(candidate)) {
      const text = candidate
        .map((part) => typeof part === 'string' ? part : (part?.text || part?.content || ''))
        .filter(Boolean).join('\n').trim();
      if (text) return text;
    }
  }
  return '';
}
function parseAiJson(text) {
  const cleaned = text
    .replace(new RegExp('\x60\x60\x60json', 'gi'), '')
    .replace(new RegExp('\x60\x60\x60', 'g'), '')
    .trim();
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}
function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime())
    ? new Date().toISOString().split('T')[0]
    : date.toISOString().split('T')[0];
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

function normalizeRecommendationContract(value, context = {}) {
  const rawText = recommendationString(value).replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim();
  const text = rawText.replace(/\s+/g, ' ').trim();
  if (!text || /^(n\/?a|not applicable|none|null|undefined|-)$/i.test(text)) return ROUTINE_RECOMMENDATION;
  if (/^no immediate communications action recommended\b/i.test(text)) return ROUTINE_RECOMMENDATION;
  if (/^review the source details before taking communications action\b/i.test(text)) return SOURCE_REVIEW_RECOMMENDATION;
  const requiredHeadings = ['Strategic Intent', 'Audience Focus', 'Message Angle', 'Channel Strategy', 'Execution Plan', 'Guardrails', 'Expected Outcome', 'Next Phase'];
  if (requiredHeadings.every((heading) => rawText.includes(`## ${heading}`))) return rawText;

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

return $input.all().map((item, index) => {
  let meta;
  try {
    meta = $('Attach DB Strategic Priorities').itemMatching(index)?.json || {};
  } catch (error) {
    throw new Error(`lineage_link_failed: ${error?.message || 'unable to resolve linked source item'}`);
  }

  const prepared = meta;
  const requiredLineage = ['raw_result_id', 'district_id', 'link', 'title'];
  const missingLineage = requiredLineage.filter((field) => !String(meta[field] || '').trim());
  if (missingLineage.length) {
    throw new Error(`lineage_missing: ${missingLineage.join(',')}`);
  }

  const contextDistrict = meta.strategic_priority_profile?.district_id;
  if (contextDistrict && contextDistrict !== meta.district_id) {
    throw new Error(`lineage_district_mismatch: ${meta.district_id} != ${contextDistrict}`);
  }

  const aiText = extractAiText(item.json);
  const cleanJson = aiText ? parseAiJson(aiText) : null;

  if (!cleanJson) {
    return {
      json: {
        story_candidate_id: prepared.story_candidate_id || meta.story_candidate_id || null,
        raw_result_id: prepared.raw_result_id || meta.raw_result_id || null,
        profile_version: prepared.profile_version || meta.profile_version || 1,
        date: formatDate(prepared.date || meta.date || ''),
        headline: prepared.headline || meta.title || meta.headline || '',
        summary: prepared.summary || null,
        source: prepared.source || meta.source || '',
        author: 'Unknown',
        contact_info: 'N/A',
        sentiment: 0,
        risk_level: 'Low',
        calculated_value: 62.5,
        link: prepared.link || meta.link || '',
        tags: [],
        innovation_flag: false,
        innovation_reason: 'N/A',
        recommendation: 'Review the source details before taking communications action.',
        source_query: prepared.source_query || meta.source_query || '',
        district_id: prepared.district_id || meta.district_id || '',
        source_type: prepared.source_type || meta.source_type || 'news',
        relevance_score: 0,
        ai_parse_error: aiText ? aiText.slice(0, 500) : 'No AI text output',
      },
    };
  }


  function buildStrategicAlignment(data) {
    const isBlank = (value) => {
      const v = String(value ?? '').trim();
      return !v || /^(n\/?a|not applicable|none|null|undefined|-)$/i.test(v);
    };
    const title = String(data.strategic_alignment ?? '').trim();
    const explanation = String(data.alignment_explanation ?? '').trim();
    const rawReason = String(data.innovation_reason ?? '').trim();
    if (!isBlank(title) && !isBlank(explanation)) {
      const cleanTitle = title.replace(/^\*\*|\*\*$/g, '').trim();
      return { flag: true, reason: `**${cleanTitle}** – ${explanation}` };
    }
    const legacyFlag = data.innovation_flag === true || data.innovation_flag === 'true';
    if (legacyFlag && !isBlank(rawReason)) return { flag: true, reason: rawReason };
    return { flag: false, reason: 'N/A' };
  }
  const strategicAlignment = buildStrategicAlignment(cleanJson);

  function normalizeDistrictEntityLanguage(text, districtId) {
    if (districtId !== 'chiefs-for-change' || !text) return text;
    return String(text)
      .replace(/the district's/gi, "the organization's")
      .replace(/district's/gi, "organization's")
      .replace(/the district/gi, 'the organization')
      .replace(/district priorities/gi, 'organization priorities')
      .replace(/district priority/gi, 'organization priority')
      .replace(/district/gi, 'organization');
  }

  const title = prepared.headline || meta.title || meta.headline || '';
  const link = prepared.link || meta.link || '';
  const date = prepared.date || meta.date || '';
  const source = prepared.source || meta.source?.name || (typeof meta.source === 'string' ? meta.source : '');

  function detectSensitivePersonnelTrustIssue(fields = {}) {
    const haystack = [fields.headline, fields.summary, fields.risk, fields.tags].join(' ').toLowerCase();
    return /(teacher|educator|staff|employee|principal|coach|school employee|high school employee).{0,120}(arrest|charged|charges|obscene|sexual|child|children|minor|internet crime|distribution|misconduct|investigation)|(?:arrest|charged|charges|obscene|sexual|child|children|minor|internet crime|distribution|misconduct|investigation).{0,120}(teacher|educator|staff|employee|principal|coach|school employee|high school employee)/i.test(haystack);
  }

  function organizationKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  const GENERIC_DOCUMENT_HOSTS = new Set(['docs.google.com', 'drive.google.com', 'boarddocs.com', 'go.boarddocs.com', 'dropbox.com', 'www.dropbox.com']);
  function sourceHostname(value) {
    try { return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
  }
  function isDistrictControlledNewsSource(fields = {}) {
    const sourceKey = organizationKey(fields.source);
    const districtKey = organizationKey(fields.districtName || fields.districtId);
    if (sourceKey && districtKey && sourceKey === districtKey) return true;
    const storyHost = sourceHostname(fields.link);
    if (!storyHost || GENERIC_DOCUMENT_HOSTS.has(storyHost)) return false;
    const sourceUrls = fields.strategicProfile?.source_urls || [];
    return sourceUrls.some((url) => {
      const officialHost = sourceHostname(url);
      return officialHost && !GENERIC_DOCUMENT_HOSTS.has(officialHost)
        && (storyHost === officialHost || storyHost.endsWith(`.${officialHost}`));
    });
  }

  function isDistrictControlledContent(fields = {}) {
    const sourceKey = organizationKey(fields.source);
    const districtKey = organizationKey(fields.districtName || fields.districtId);
    return Boolean(sourceKey && districtKey && sourceKey === districtKey);
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

  function classifyInstitutionalIncident(fields = {}) {
    const text = [fields.headline, fields.summary, fields.monitoringExcerpt, fields.risk, fields.tags, fields.author, fields.source, fields.link].join(' ').toLowerCase();
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

  function shouldSuppressStrategicAlignment(context = {}) {
    if (context.deathArrestFatality) return true;
    return Boolean(context.incident && !context.affirmativeStrategicAction);
  }

  function isAdverseExperienceWithoutAffirmativeDistrictAction(fields = {}) {
    const text = [fields.headline, fields.summary, fields.monitoringExcerpt].join(' ').toLowerCase();
    const adverseExperience = /\b(anti[- ]black bias|racial bias|bias|discriminat(?:ion|ory)|racism|racist|unsafe|harass(?:ment|ed|ing)?|bully(?:ing|ied)?|civil rights complaint|parent complaint|family complaint|alleg(?:ation|ed|es)|inequit(?:y|able)|exclusion)\b/i.test(text);
    if (!adverseExperience) return false;
    const organizationPattern = '\\b(?:district|school|school board|board|administration|administrators?|officials?)\\b';
    const actionPattern = '\\b(?:implement(?:ed|s|ing)?|launch(?:ed|es|ing)?|adopt(?:ed|s|ing)?|approv(?:e|ed|es|ing)|complet(?:e|ed|es|ing)|expand(?:ed|s|ing)?|creat(?:e|ed|es|ing)|introduc(?:e|ed|es|ing)|chang(?:e|ed|es|ing)|revis(?:e|ed|es|ing)|train(?:ed|s|ing)?|investigat(?:e|ed|es|ing)|respond(?:ed|s|ing)?|resolv(?:e|ed|es|ing)|publish(?:ed|es|ing)?|report(?:ed|s|ing)?|measur(?:e|ed|es|ing)|open(?:ed|s|ing)?)\\b';
    const organization = new RegExp(organizationPattern, 'i');
    const actions = new RegExp(actionPattern, 'gi');
    const negatedPrefix = /(?:\b(?:not|never|without)\b|\b(?:yet|failed|fails|refused|refuses|declined|declines)\s+to\b|\b(?:didn['’]t|doesn['’]t|hasn['’]t|haven['’]t|hadn['’]t|won['’]t)\b)(?:\s+\w+){0,3}\s*$/i;
    const affirmativeDistrictAction = text
      .split(/(?<=[.!?;])\s+/)
      .some((sentence) => {
        if (!organization.test(sentence)) return false;
        actions.lastIndex = 0;
        for (const match of sentence.matchAll(actions)) {
          const actionIndex = match.index ?? 0;
          const prefix = sentence.slice(Math.max(0, actionIndex - 70), actionIndex);
          if (negatedPrefix.test(prefix)) continue;
          const organizationMatch = organization.exec(sentence);
          if (organizationMatch && Math.abs(actionIndex - organizationMatch.index) <= 120) return true;
        }
        return false;
      });
    return !affirmativeDistrictAction;
  }

  function calibrateSadVsBadSentiment(rawSentiment, fields = {}) {
    let s = Number(rawSentiment || 0);
    const haystack = [fields.headline, fields.summary, fields.risk, fields.tags, fields.author, fields.source, fields.link].join(' ').toLowerCase();
    const incidentContext = classifyInstitutionalIncident(fields);
    const griefWithoutBlame = /\b(mourns?|mourning|death|died|killed|loss of|memorial|grief)\b/i.test(haystack);
    const districtControlled = isDistrictControlledContent(fields);
    const routineDistrictNotice = districtControlled && isRoutineDistrictNotice(haystack);
    const neutralCapitalInvestment = isNeutralCapitalInvestment(haystack);
    const sensitivePersonnelTrustIssue = detectSensitivePersonnelTrustIssue(fields);
    if (sensitivePersonnelTrustIssue && s > -0.3) s = -0.7;
    if (incidentContext.incident && incidentContext.documentedFailure) {
      s = Math.min(s, -0.3);
    } else if (incidentContext.incident && incidentContext.institutionalNexus) {
      s = Math.min(s, 0.1);
    } else if ((incidentContext.incident || griefWithoutBlame) && !sensitivePersonnelTrustIssue) {
      s = Math.max(-0.1, Math.min(0.1, s));
    }
    if (neutralCapitalInvestment && !incidentContext.documentedFailure && !sensitivePersonnelTrustIssue && s < 0) s = 0;
    if (routineDistrictNotice && !incidentContext.documentedFailure && !sensitivePersonnelTrustIssue) s = 0;
    else if (districtControlled && !incidentContext.documentedFailure && !sensitivePersonnelTrustIssue) s = Math.max(-0.1, Math.min(0.25, s));
    if (isProactiveTruthTelling(haystack) && !incidentContext.documentedFailure && !sensitivePersonnelTrustIssue && s < 0.1) s = 0.1;
    if (isSourceAuthoredContent(haystack) && !incidentContext.documentedFailure && !sensitivePersonnelTrustIssue && s > 0.25) s = 0.25;
    return s;
  }

  const ACCESS_LIMITATION_CLAIM = /\b(paywall(?:ed)?|behind (?:a )?paywall|article (?:content )?(?:provided )?is incomplete|incomplete article|full article (?:text|content)|article (?:is )?truncated|truncated article|content (?:is )?unavailable|await (?:the )?(?:full )?article|monitor for full article)\b/i;
  function deterministicSentimentFallback(fields = {}) {
    const haystack = [fields.headline, fields.summary, fields.monitoringExcerpt].join(' ').toLowerCase();
    const positive = /\b(achievement|award|improv(?:e|ed|ement)|increase|growth|success|successful|launch(?:ed)?|creative|innovation|innovative|partnership|opportunity|proactive|transparent|transparency|responsib(?:le|ility)|savings?|surplus|graduation)\b/i.test(haystack);
    const negative = /\b(backlash|criticism|controversy|lawsuit|negligence|failure|failed|unsafe|harm|arrest|misconduct|decline|deficit|shortage|disruption|closure|cuts?)\b/i.test(haystack);
    if (positive && !negative) return 0.25;
    if (negative && !positive) return -0.25;
    return 0;
  }

  const CORE_TAGS = new Set(['Academic Success', 'Engagement', 'Innovation', 'Operations & Finance', 'Safety & Wellness']);
  function canonicalTags(tags) {
    if (!Array.isArray(tags)) return [];
    return [...new Set(tags.filter(tag => CORE_TAGS.has(tag)))];
  }

  const cpm = 12.50;
  const rawData = String(prepared.data ?? '');
  const normalizedData = rawData.replace(/\\n/g, '\n');
  const dataParts = normalizedData.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const monitoringExcerpt = String(prepared.monitoring_excerpt || prepared.snippet || prepared.summary || (dataParts.length > 1 ? dataParts.slice(1).join('\n\n') : '')).trim();
  const originalSummary = String(cleanJson.summary ?? '').trim();
  const originalRecommendation = recommendationString(cleanJson.local_recommendation);
  const summary = ACCESS_LIMITATION_CLAIM.test(originalSummary) && monitoringExcerpt ? monitoringExcerpt : originalSummary;
  const isBlankRecommendation = (value) => !String(value ?? '').trim()
    || /^(n\/?a|not applicable|none|null|undefined|-)$/i.test(String(value).trim());
  let recommendation = ACCESS_LIMITATION_CLAIM.test(originalSummary) || ACCESS_LIMITATION_CLAIM.test(originalRecommendation)
    ? 'Review the source details before taking communications action.'
    : (isBlankRecommendation(originalRecommendation)
      ? 'No immediate communications action recommended. Continue routine monitoring.'
      : originalRecommendation);
  const interpretationText = [title, summary, monitoringExcerpt, cleanJson.author, source, link].join(' ').toLowerCase();
  const repeatsDeliveredTransparency = /\b(prepare|issue|hold|publish|write|create|communicate|explain|provide)\b.{0,100}\b(statement|press conference|news conference|column|op[- ]?ed|budget|funding|fiscal|legislation|transparent|transparency)\b/i.test(originalRecommendation);
  if (isProactiveTruthTelling(interpretationText) && repeatsDeliveredTransparency) {
    recommendation = "Amplify the district's existing transparent communication and monitor stakeholder understanding; do not recommend repeating actions already documented in the story.";
  }
  const hasSentiment = cleanJson.sentiment !== null
    && cleanJson.sentiment !== undefined
    && String(cleanJson.sentiment).trim() !== ''
    && Number.isFinite(Number(cleanJson.sentiment));
  const rawSentiment = hasSentiment
    ? Number(cleanJson.sentiment)
    : deterministicSentimentFallback({ headline: title, summary, monitoringExcerpt });
  const sentimentFields = {
    headline: title,
    summary,
    recommendation,
    risk: cleanJson.risk,
    tags: Array.isArray(cleanJson.tags) ? cleanJson.tags.join(' ') : '',
    author: cleanJson.author,
    source,
    districtName: prepared.district_name || meta.district_name || '',
    districtId: prepared.district_id || meta.district_id || '',
    link,
  };
  const incidentContext = classifyInstitutionalIncident({ ...sentimentFields, monitoringExcerpt });
  const sentiment = calibrateSadVsBadSentiment(rawSentiment, sentimentFields);
  const sensitivePersonnelTrustIssue = detectSensitivePersonnelTrustIssue(sentimentFields);
  const outputRisk = sensitivePersonnelTrustIssue ? 'High' : cleanJson.risk;
  const outputTags = canonicalTags(sensitivePersonnelTrustIssue ? ['Safety & Wellness'] : cleanJson.tags);
  const suppressStrategicAlignment = shouldSuppressStrategicAlignment(incidentContext)
    || isAdverseExperienceWithoutAffirmativeDistrictAction({ ...sentimentFields, monitoringExcerpt });
  const outputStrategicAlignment = sensitivePersonnelTrustIssue || suppressStrategicAlignment
    ? { flag: false, reason: 'N/A' }
    : strategicAlignment;
  const sadWithoutInstitutionalBlame = incidentContext.fatalityOrDeath
    && !incidentContext.institutionalNexus
    && !incidentContext.documentedFailure
    && !sensitivePersonnelTrustIssue;
  if (sadWithoutInstitutionalBlame) {
    recommendation = "Treat this as a sensitive community tragedy, not a district reputation-building opportunity. Use empathetic, factual communication; protect family privacy; coordinate approved grief-support information; avoid speculation; and monitor for material misinformation or district-related questions.";
  }
  recommendation = normalizeRecommendationContract(recommendation, { risk: outputRisk, sentiment });
  function inferRelevanceScore(data, riskLevel, calibratedSentiment) {
    const raw = data.relevance_score;
    const hasExplicit = raw !== undefined && raw !== null && String(raw).trim() !== '';
    if (hasExplicit) {
      const explicit = Number(raw);
      return Number.isFinite(explicit) ? Math.max(0, Math.min(5, explicit)) : 0;
    }
    const recommendation = String(data.local_recommendation ?? '').trim();
    const hasRecommendation = recommendation && !/^(n\/?a|not applicable|none|null|undefined|-)$/i.test(recommendation);
    if (riskLevel === 'High' || riskLevel === 'Medium' || calibratedSentiment < -0.2 || hasRecommendation) return 5;
    return 0;
  }
  const relevanceScore = inferRelevanceScore(cleanJson, outputRisk, sentiment);

  const multiplier = sentiment < -0.2 ? 2.0 : (sentiment > 0.5 ? 1.5 : 1);
  const value = (5000 / 1000) * cpm * multiplier;

  return {
    json: {
      story_candidate_id: prepared.story_candidate_id || meta.story_candidate_id || null,
      raw_result_id: prepared.raw_result_id || meta.raw_result_id || null,
      profile_version: prepared.profile_version || meta.profile_version || 1,
      date: formatDate(date),
      headline: title,
      summary,
      source,
      author: cleanJson.author,
      contact_info: cleanJson.contact_info,
      sentiment,
      risk_level: outputRisk,
      calculated_value: parseFloat(value.toFixed(2)),
      link,
      tags: outputTags,
      innovation_flag: outputStrategicAlignment.flag,
      innovation_reason: normalizeDistrictEntityLanguage(outputStrategicAlignment.reason, meta.district_id || (typeof prepared !== 'undefined' && prepared.district_id) || ''),
      recommendation,
      source_query: prepared.source_query || meta.source_query || '',
      district_id: prepared.district_id || meta.district_id || '',
      source_type: prepared.source_type || meta.source_type || 'news',
      is_earned_media: !isDistrictControlledNewsSource({
        source,
        link,
        districtName: prepared.district_name || meta.district_name || '',
        districtId: prepared.district_id || meta.district_id || '',
        strategicProfile: meta.strategic_priority_profile || {},
      }),
      relevance_score: relevanceScore,
    },
  };
});
