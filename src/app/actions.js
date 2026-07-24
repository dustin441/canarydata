'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClickUpFeedbackTask, createClickUpOnboardingTask, isClickUpConfigured } from '@/lib/clickup';
import { revalidatePath } from 'next/cache';
import { canonicalizeStoryUrl, requireCorrectionReason } from '@/lib/storyCorrections.mjs';
import { CUSTOMER_SEARCH_QUERY_LIMIT, searchQueryFingerprint, validateSearchQueryText } from '@/lib/queryPolicy.mjs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

async function requireCanaryActor() {
  const sessionClient = await createServerClient();
  const { data: { user: sessionUser } } = await sessionClient.auth.getUser();
  if (!sessionUser?.id) throw new Error('Authentication required.');

  const admin = createAdminClient();
  const { data: { user } } = await admin.auth.admin.getUserById(sessionUser.id);
  const actor = {
    id: user?.id || sessionUser.id,
    isAdmin: user?.app_metadata?.role === 'admin',
    districtId: user?.app_metadata?.district_id || null,
  };
  if (!actor.isAdmin && !actor.districtId) throw new Error('Canary account access is not configured.');
  return { actor, admin };
}

function assertDistrictAccess(actor, districtId) {
  if (!actor.isAdmin && (!districtId || districtId !== actor.districtId)) {
    throw new Error('You do not have access to this district.');
  }
}

function assertCanaryReviewer(actor) {
  if (!actor.isAdmin) throw new Error('Canary reviewer access is required.');
}

const SOCIAL_REVIEW_ACTIONS = new Set(['approve', 'exclude', 'restore', 'classification', 'note', 'promote']);
const SOCIAL_CLASSIFICATIONS = new Set(['owned', 'direct_tag', 'direct_mention', 'ambient']);

function cleanSocialReviewerNote(value) {
  const note = String(value || '').trim();
  if (note.length > 2000) throw new Error('Reviewer note must be 2000 characters or fewer.');
  return note;
}

async function requireSocialThreadForReview(supabase, actor, socialThreadId) {
  const { data: thread, error } = await supabase
    .from('social_threads')
    .select('id, district_id, relationship_type, visibility_status, review_version')
    .eq('id', socialThreadId)
    .maybeSingle();
  if (error) throw error;
  if (!thread) throw new Error('Social result not found.');
  assertDistrictAccess(actor, thread.district_id);
  return thread;
}

function cleanFormValue(formData, key) {
  return String(formData.get(key) || '').trim();
}

function normalizeWebsite(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function normalizePublicDocumentUrl(value) {
  const normalized = normalizeWebsite(value);
  if (!normalized) return '';
  const googleDoc = normalized.match(/^https:\/\/docs\.google\.com\/document\/d\/([^/]+)/i);
  if (googleDoc) return `https://docs.google.com/document/d/${googleDoc[1]}/export?format=txt`;
  const driveFile = normalized.match(/^https:\/\/(?:drive|docs)\.google\.com\/(?:file\/d\/|open\?id=)([^/?&]+)/i);
  if (driveFile) return `https://drive.usercontent.google.com/download?id=${driveFile[1]}&export=download`;
  return normalized;
}

function isPrivateAddress(address) {
  const value = String(address || '').toLowerCase();
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(value) === 6) {
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') ||
      value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') ||
      value.startsWith('::ffff:127.') || value.startsWith('::ffff:10.') || value.startsWith('::ffff:192.168.');
  }
  return true;
}

async function assertPublicUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only public HTTP or HTTPS URLs are supported');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname === 'metadata.google.internal') {
    throw new Error('Private network URLs are not supported');
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error('Private network URLs are not supported');
  }
  return url;
}

async function fetchPublicResource(initialUrl, maxBytes = 10 * 1024 * 1024) {
  let currentUrl = normalizeWebsite(initialUrl);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    await assertPublicUrl(currentUrl);
    const response = await fetch(currentUrl, {
      headers: { 'User-Agent': 'CanaryDataTrialSetup/1.0 (+https://www.canarydata.media)' },
      signal: AbortSignal.timeout(12000),
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      currentUrl = new URL(response.headers.get('location'), currentUrl).toString();
      continue;
    }
    if (!response.ok) throw new Error(`${response.status}`);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > maxBytes) throw new Error('Document is too large');
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new Error('Document is too large');
    return {
      url: currentUrl,
      contentType: response.headers.get('content-type') || '',
      bytes: new Uint8Array(buffer),
    };
  }
  throw new Error('Too many redirects');
}

function cleanHtmlText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&rsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value, maxLength = 900) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength).trim();
}

function findNearbySnippets(text, terms, max = 3) {
  const lower = String(text || '').toLowerCase();
  const snippets = [];
  for (const term of terms) {
    let cursor = 0;
    while (snippets.length < max) {
      const idx = lower.indexOf(term.toLowerCase(), cursor);
      if (idx < 0) break;
      const start = Math.max(0, idx - 120);
      const end = Math.min(text.length, idx + 760);
      const snippet = compactText(text.slice(start, end));
      if (snippet && !snippets.some((existing) => existing.includes(snippet.slice(0, 120)))) {
        snippets.push(snippet);
      }
      cursor = idx + term.length;
    }
    if (snippets.length >= max) break;
  }
  return snippets;
}

function extractSocialLinksFromPages(pages, baseUrl) {
  const links = new Set();
  const domains = /(facebook\.com|instagram\.com|twitter\.com|x\.com|tiktok\.com|youtube\.com|linkedin\.com)/i;
  for (const page of pages) {
    for (const match of String(page.html || '').matchAll(/href=["']([^"']+)["']/gi)) {
      const raw = match[1];
      if (!domains.test(raw)) continue;
      try {
        const url = new URL(raw, page.url || baseUrl);
        url.hash = '';
        links.add(url.toString());
      } catch {}
    }
  }
  return [...links].slice(0, 16).join('\n');
}

function sameHost(url, root) {
  try {
    return new URL(url).hostname.replace(/^www\./, '') === new URL(root).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
}

function discoverCandidateUrls(homeHtml, website) {
  const root = new URL(website);
  const urls = new Map([[root.toString(), 100]]);
  const keywords = /(about|mission|vision|values|strategic|plan|goals|board|district|schools|campus|directory|departments|leadership|superintendent|profile)/i;
  const boosts = [
    '/about', '/about-us', '/district', '/our-district', '/mission', '/vision', '/strategic-plan',
    '/strategic-plan-2024', '/board', '/schools', '/campuses', '/departments', '/superintendent',
  ];
  for (const path of boosts) {
    try { urls.set(new URL(path, root).toString(), 10); } catch {}
  }
  for (const match of String(homeHtml || '').matchAll(/href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const label = cleanHtmlText(match[2] || '');
    try {
      const url = new URL(href, root);
      url.hash = '';
      if (!sameHost(url.toString(), root.toString())) continue;
      if (!/^https?:$/i.test(url.protocol)) continue;
      const haystack = `${url.pathname} ${label}`;
      if (keywords.test(haystack)) {
        const score = /strategic|mission|vision|values|goals|plan/i.test(haystack) ? 80 : 40;
        urls.set(url.toString(), Math.max(urls.get(url.toString()) || 0, score));
      }
    } catch {}
  }
  return [...urls.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .slice(0, 10);
}

async function extractDocumentText({ bytes, contentType = '', name = '' }) {
  const kind = `${contentType} ${name}`.toLowerCase();
  if (kind.includes('pdf') || kind.endsWith('.pdf')) {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    return String(result.text || '');
  }
  if (kind.includes('wordprocessingml') || kind.endsWith('.docx')) {
    const mammothModule = await import('mammoth');
    const mammoth = mammothModule.default || mammothModule;
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return String(result.value || '');
  }
  if (kind.includes('text/') || kind.includes('html') || /\.(txt|md|html?|csv)$/i.test(name)) {
    const decoded = new TextDecoder().decode(bytes);
    return kind.includes('html') || /\.html?$/i.test(name) ? cleanHtmlText(decoded) : decoded;
  }
  throw new Error('Use a public webpage, PDF, DOCX, TXT, or Markdown document');
}

async function fetchPage(url) {
  const resource = await fetchPublicResource(url, 3 * 1024 * 1024);
  const decoded = new TextDecoder().decode(resource.bytes);
  const isHtml = resource.contentType.includes('html');
  return {
    url: resource.url,
    html: isHtml ? decoded : '',
    text: await extractDocumentText({ bytes: resource.bytes, contentType: resource.contentType, name: resource.url }),
    contentType: resource.contentType,
  };
}

function extractSchoolNames(text) {
  const names = new Set();
  const patterns = [
    /\b([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,5}\s+(?:Elementary|Middle|High|Intermediate|Primary|Junior High|Magnet|Academy|School))\b/g,
    /\b([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,4}\s+(?:Campus|Center))\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of String(text || '').matchAll(pattern)) {
      const name = compactText(match[1], 90);
      if (!/^(Home|About|Contact|Search|Find|Our|The)\b/.test(name)) names.add(name);
    }
  }
  return [...names].slice(0, 30).join('\n');
}

function buildKeywords({ organizationName, city, state, schoolNames }) {
  const base = new Set([organizationName].filter(Boolean));
  const acronym = String(organizationName || '')
    .replace(/\b(independent|unified|city|county|community|public|school|schools|district|isd|usd|csd)\b/gi, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  if (acronym.length >= 2 && acronym.length <= 6) base.add(acronym);
  if (city && state) base.add(`${city} ${state}`);
  String(schoolNames || '').split('\n').slice(0, 8).forEach((name) => base.add(name.trim()));
  return [...base].filter(Boolean).join('\n');
}

export async function discoverOnboardingProfile(formData) {
  const organizationName = cleanFormValue(formData, 'organization_name');
  const website = normalizeWebsite(formData.get('website'));
  const strategicPlanUrl = normalizePublicDocumentUrl(formData.get('strategic_plan_url'));
  const strategicPlanFile = formData.get('strategic_plan_file');
  const city = cleanFormValue(formData, 'city');
  const state = cleanFormValue(formData, 'state');
  if (!organizationName) throw new Error('District or organization name is required');
  if (!website) throw new Error('Website is required');

  const pages = [];
  const strategicDocuments = [];
  const errors = [];
  let candidateUrls = [website];

  try {
    const home = await fetchPage(website);
    pages.push(home);
    candidateUrls = discoverCandidateUrls(home.html, website);
  } catch (error) {
    errors.push(`${website}: ${error.message || 'Unable to fetch website'}`);
  }

  for (const url of candidateUrls) {
    if (pages.some((page) => page.url === url)) continue;
    if (pages.length >= 8) break;
    try {
      pages.push(await fetchPage(url));
    } catch (error) {
      errors.push(`${url}: ${error.message || 'Unable to fetch page'}`);
    }
  }

  if (strategicPlanUrl) {
    try {
      const plan = await fetchPage(strategicPlanUrl);
      strategicDocuments.push({ label: plan.url, text: plan.text });
    } catch (error) {
      errors.push(`${strategicPlanUrl}: ${error.message || 'Unable to read strategic plan'}`);
    }
  }

  if (strategicPlanFile && typeof strategicPlanFile.arrayBuffer === 'function' && strategicPlanFile.size > 0) {
    try {
      if (strategicPlanFile.size > 10 * 1024 * 1024) throw new Error('Document is too large (10 MB maximum)');
      const bytes = new Uint8Array(await strategicPlanFile.arrayBuffer());
      const text = await extractDocumentText({
        bytes,
        contentType: strategicPlanFile.type || '',
        name: strategicPlanFile.name || '',
      });
      strategicDocuments.push({ label: strategicPlanFile.name || 'Uploaded strategic plan', text });
    } catch (error) {
      errors.push(`${strategicPlanFile.name || 'Uploaded strategic plan'}: ${error.message || 'Unable to read document'}`);
    }
  }

  const websiteText = pages.map((page) => page.text).join('\n\n');
  const strategicPlanText = strategicDocuments
    .map((document) => document.text)
    .join('\n\n')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, 60000);
  const combinedText = [websiteText, strategicPlanText].filter(Boolean).join('\n\n');
  const missionSnippets = findNearbySnippets(combinedText, ['mission', 'vision', 'values', 'beliefs', 'we believe', 'core values'], 4);
  const prioritySnippets = findNearbySnippets(combinedText, ['strategic plan', 'priority', 'priorities', 'goals', 'focus areas', 'board goals', 'portrait of a graduate'], 4);
  const discoveredSocials = extractSocialLinksFromPages(pages, website);
  const discoveredSchools = extractSchoolNames(combinedText);
  const sourceUrls = [
    ...pages.map((page) => page.url),
    ...strategicDocuments.map((document) => document.label),
  ].join('\n');
  const fetchError = errors.length ? errors.slice(0, 8).join('\n') : '';

  const confirmedProfile = {
    organization_name: organizationName,
    website,
    strategic_plan_url: strategicPlanUrl,
    strategic_plan_text: strategicPlanText,
    location: [city, state, cleanFormValue(formData, 'zip')].filter(Boolean).join(', '),
    social_handles: cleanFormValue(formData, 'social_handles') || discoveredSocials,
    keywords: cleanFormValue(formData, 'keywords') || buildKeywords({ organizationName, city, state, schoolNames: discoveredSchools }),
    school_names: cleanFormValue(formData, 'school_names') || discoveredSchools,
    known_exclusions: cleanFormValue(formData, 'known_exclusions'),
    mission_vision_values: missionSnippets.join('\n\n'),
    strategic_priorities: prioritySnippets.join('\n\n'),
    discovered_source_urls: sourceUrls,
    discovery_notes: pages.length || strategicDocuments.length
      ? `Canary reviewed ${pages.length} public page${pages.length === 1 ? '' : 's'} and ${strategicDocuments.length} strategic plan document${strategicDocuments.length === 1 ? '' : 's'}. Please approve or edit before review.${fetchError ? `\n\nSources needing manual review:\n${fetchError}` : ''}`
      : `Website discovery needs manual review.${fetchError ? `\n\n${fetchError}` : ''}`,
  };

  return {
    ok: true,
    discovered_profile: {
      website_fetched: pages.length > 0,
      fetch_error: fetchError || null,
      pages_reviewed: pages.map((page) => page.url),
      strategic_plan_sources: strategicDocuments.map((document) => document.label),
      strategic_plan_characters: strategicPlanText.length,
      discovered_socials: discoveredSocials,
      mission_vision_values: missionSnippets.join('\n\n'),
      strategic_priorities: prioritySnippets.join('\n\n'),
      school_names: discoveredSchools,
    },
    confirmed_profile: confirmedProfile,
  };
}

export async function submitLeadRequest(formData) {
  const supabase = createAdminClient();
  const lead = {
    organization_name: cleanFormValue(formData, 'organization_name'),
    website: normalizeWebsite(formData.get('website')),
    contact_name: cleanFormValue(formData, 'contact_name'),
    contact_email: cleanFormValue(formData, 'contact_email').toLowerCase(),
    contact_title: cleanFormValue(formData, 'contact_title'),
    notes: cleanFormValue(formData, 'notes'),
  };

  if (!lead.organization_name) throw new Error('District or organization name is required');
  if (!lead.contact_name) throw new Error('Contact name is required');
  if (!lead.contact_email) throw new Error('Contact email is required');

  const message = [
    'Light demo/sign-up lead submitted.',
    '',
    `Contact: ${lead.contact_name} <${lead.contact_email}>`,
    `Title: ${lead.contact_title || 'Unknown'}`,
    `Organization: ${lead.organization_name}`,
    `Website: ${lead.website || 'Not provided'}`,
    '',
    `Notes:\n${lead.notes || 'None provided'}`,
    '',
    'Workflow note: keep this as a light lead capture. If approved for a trial, send the hidden /onboarding link so the prospect can confirm mission/vision/values, strategic priorities, socials, keywords, schools, and exclusions before Canary runs manual review/backfill.',
  ].join('\n');

  const { data: feedback, error } = await supabase.from('feedback').insert({
    message,
    district_name: lead.organization_name,
    district_id: null,
    status: 'lead_request',
  }).select('*').single();

  if (error) throw error;

  if (isClickUpConfigured()) {
    try {
      const task = await createClickUpFeedbackTask(feedback);
      await supabase.from('feedback').update({
        status: 'lead_clickup_synced',
        clickup_task_id: task?.id || null,
        clickup_task_url: task?.url || null,
        clickup_synced_at: new Date().toISOString(),
        clickup_sync_error: null,
      }).eq('id', feedback.id);
    } catch (clickupError) {
      await supabase.from('feedback').update({
        status: 'lead_clickup_failed',
        clickup_sync_error: clickupError.message || 'Unknown ClickUp error',
      }).eq('id', feedback.id);
    }
  }

  revalidatePath('/signup');
  return { ok: true, id: feedback.id };
}

export async function submitOnboardingRequest(formData) {
  const supabase = createAdminClient();
  let confirmedProfile = {};
  try {
    confirmedProfile = JSON.parse(cleanFormValue(formData, 'confirmed_profile') || '{}');
  } catch {
    confirmedProfile = {};
  }
  const request = {
    organization_name: cleanFormValue(formData, 'organization_name'),
    website: normalizeWebsite(formData.get('website')),
    contact_name: cleanFormValue(formData, 'contact_name'),
    contact_email: cleanFormValue(formData, 'contact_email').toLowerCase(),
    contact_title: cleanFormValue(formData, 'contact_title'),
    city: cleanFormValue(formData, 'city'),
    state: cleanFormValue(formData, 'state'),
    zip: cleanFormValue(formData, 'zip'),
    social_handles: cleanFormValue(formData, 'social_handles'),
    keywords: cleanFormValue(formData, 'keywords'),
    school_names: cleanFormValue(formData, 'school_names'),
    known_exclusions: cleanFormValue(formData, 'known_exclusions'),
    current_monitoring: cleanFormValue(formData, 'current_monitoring'),
    notes: cleanFormValue(formData, 'notes'),
    discovered_profile: {
      source: 'trial_signup_discovery',
      submitted_website: normalizeWebsite(formData.get('website')),
      approved_at: new Date().toISOString(),
    },
    confirmed_profile: confirmedProfile,
    status: 'customer_confirmed',
    trial_status: 'not_started',
    payment_status: 'pending',
    access_status: 'pending_setup',
  };

  if (!request.organization_name) throw new Error('District or organization name is required');
  if (!request.website) throw new Error('Website is required');
  if (!request.contact_name) throw new Error('Contact name is required');
  if (!request.contact_email) throw new Error('Contact email is required');

  let saved = null;
  let dbError = null;
  try {
    const { data, error } = await supabase
      .from('onboarding_requests')
      .insert(request)
      .select('*')
      .single();
    if (error) throw error;
    saved = data;
  } catch (error) {
    dbError = error;
    try {
      const fallbackMessage = [
        '30-day trial onboarding request confirmed by prospect.',
        '',
        `Contact: ${request.contact_name} <${request.contact_email}>`,
        `Title: ${request.contact_title || 'Unknown'}`,
        `Website: ${request.website}`,
        `Location: ${[request.city, request.state, request.zip].filter(Boolean).join(', ') || 'Unknown'}`,
        '',
        'Confirmed setup:',
        JSON.stringify(confirmedProfile, null, 2),
        '',
        'Raw intake:',
        JSON.stringify(request, null, 2),
      ].join('\n');
      const { data: feedbackFallback, error: fallbackError } = await supabase
        .from('feedback')
        .insert({
          message: fallbackMessage,
          district_name: request.organization_name,
          district_id: null,
          status: 'onboarding_request',
        })
        .select('*')
        .single();
      if (fallbackError) throw fallbackError;
      saved = {
        ...request,
        id: feedbackFallback.id,
        created_at: feedbackFallback.created_at,
        fallback_table: 'feedback',
      };
      dbError = null;
    } catch (fallbackError) {
      dbError = fallbackError;
      saved = { ...request, id: null, created_at: new Date().toISOString() };
    }
  }

  let clickupTask = null;
  let clickupError = null;
  if (isClickUpConfigured()) {
    try {
      clickupTask = await createClickUpOnboardingTask(saved);
      if (saved.id) {
        await supabase
          .from('onboarding_requests')
          .update({
            clickup_task_id: clickupTask?.id || null,
            clickup_task_url: clickupTask?.url || null,
            clickup_synced_at: new Date().toISOString(),
            clickup_sync_error: null,
          })
          .eq('id', saved.id);
      }
    } catch (error) {
      clickupError = error;
      if (saved.id) {
        await supabase
          .from('onboarding_requests')
          .update({ clickup_sync_error: error.message || 'Unknown ClickUp error' })
          .eq('id', saved.id);
      }
    }
  }

  if (!saved.id && !clickupTask) {
    throw new Error(dbError?.message || clickupError?.message || 'Unable to submit onboarding request');
  }

  return {
    ok: true,
    id: saved.id,
    clickup_task_url: clickupTask?.url || null,
    stored: Boolean(saved.id),
  };
}

export async function setEarnedMedia(id, value) {
  const { actor, admin: supabase } = await requireCanaryActor();
  const { data: story } = await supabase.from('news_stories').select('district_id').eq('id', id).maybeSingle();
  assertDistrictAccess(actor, story?.district_id);
  const { error } = await supabase
    .from('news_stories')
    .update({ is_earned_media: value })
    .eq('id', id);
  if (error) throw error;
}

export async function saveNote(id, notes) {
  const { actor, admin: supabase } = await requireCanaryActor();
  const { data: story } = await supabase.from('news_stories').select('district_id').eq('id', id).maybeSingle();
  assertDistrictAccess(actor, story?.district_id);
  const { error } = await supabase
    .from('news_stories')
    .update({ notes: notes || null })
    .eq('id', id);
  if (error) throw error;
}

export async function addManualStory({ districtId, link, headline, source, date, summary, reason }) {
  const { actor, admin: supabase } = await requireCanaryActor();
  const targetDistrictId = String(districtId || '').trim();
  assertDistrictAccess(actor, targetDistrictId);
  if (!targetDistrictId) throw new Error('Select a district.');

  const canonicalUrl = canonicalizeStoryUrl(link);
  const cleanHeadline = String(headline || '').trim();
  const cleanSource = String(source || '').trim();
  const cleanDate = String(date || '').trim();
  const cleanReason = requireCorrectionReason(reason);
  if (!cleanHeadline) throw new Error('Headline is required.');
  if (!cleanSource) throw new Error('Source is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) throw new Error('A valid story date is required.');

  const [{ data: canonicalMatch, error: canonicalError }, { data: linkMatch, error: linkError }] = await Promise.all([
    supabase.from('news_stories').select('id, visibility_status').eq('district_id', targetDistrictId).eq('canonical_url', canonicalUrl).maybeSingle(),
    supabase.from('news_stories').select('id, visibility_status').eq('district_id', targetDistrictId).eq('link', String(link).trim()).maybeSingle(),
  ]);
  if (canonicalError) throw canonicalError;
  if (linkError) throw linkError;
  const existing = canonicalMatch || linkMatch;
  if (existing) {
    const nextStep = existing.visibility_status === 'excluded' ? 'Restore it from Corrections instead.' : 'Open the existing story instead.';
    throw new Error(`This story already exists. ${nextStep}`);
  }

  const { data, error } = await supabase.rpc('canary_add_manual_story', {
    p_actor_user_id: actor.id,
    p_district_id: targetDistrictId,
    p_canonical_url: canonicalUrl,
    p_link: String(link).trim(),
    p_headline: cleanHeadline,
    p_source: cleanSource,
    p_date: cleanDate,
    p_reason: cleanReason,
    p_summary: String(summary || '').trim() || null,
  });
  if (error) throw error;
  revalidatePath('/dashboard');
  return data;
}

export async function excludeStory({ storyId, reason, expectedVersion }) {
  const { actor, admin: supabase } = await requireCanaryActor();
  const { data: story, error: storyError } = await supabase
    .from('news_stories')
    .select('id, district_id, correction_version, visibility_status')
    .eq('id', storyId)
    .maybeSingle();
  if (storyError) throw storyError;
  if (!story) throw new Error('Story not found.');
  assertDistrictAccess(actor, story.district_id);
  if (story.visibility_status === 'excluded') throw new Error('Story is already excluded.');

  const { data, error } = await supabase.rpc('canary_exclude_story', {
    p_actor_user_id: actor.id,
    p_story_id: story.id,
    p_reason: requireCorrectionReason(reason),
    p_expected_version: Number.isInteger(expectedVersion) ? expectedVersion : story.correction_version,
  });
  if (error) throw error;
  revalidatePath('/dashboard');
  return data;
}

export async function restoreStory({ storyId, exclusionEventId, reason, expectedVersion }) {
  const { actor, admin: supabase } = await requireCanaryActor();
  const { data: story, error: storyError } = await supabase
    .from('news_stories')
    .select('id, district_id, correction_version, visibility_status')
    .eq('id', storyId)
    .maybeSingle();
  if (storyError) throw storyError;
  if (!story) throw new Error('Story not found.');
  assertDistrictAccess(actor, story.district_id);
  if (story.visibility_status !== 'excluded') throw new Error('Story is not excluded.');

  const { data: event, error: eventError } = await supabase
    .from('story_correction_events')
    .select('id, district_id, story_id, action')
    .eq('id', exclusionEventId)
    .maybeSingle();
  if (eventError) throw eventError;
  if (!event || event.story_id !== story.id || event.action !== 'exclude') throw new Error('Matching exclusion event not found.');
  assertDistrictAccess(actor, event.district_id);

  const { data, error } = await supabase.rpc('canary_restore_story', {
    p_actor_user_id: actor.id,
    p_story_id: story.id,
    p_exclusion_event_id: event.id,
    p_reason: requireCorrectionReason(reason),
    p_expected_version: Number.isInteger(expectedVersion) ? expectedVersion : story.correction_version,
  });
  if (error) throw error;
  revalidatePath('/dashboard');
  return data;
}

export async function reviewSocialThread({ socialThreadId, action, expectedVersion, classification = null, reviewerNote = null }) {
  const { actor, admin: supabase } = await requireCanaryActor();
  assertCanaryReviewer(actor);
  if (!SOCIAL_REVIEW_ACTIONS.has(action)) throw new Error('Unsupported social review action.');
  if (action === 'classification' && !SOCIAL_CLASSIFICATIONS.has(classification)) {
    throw new Error('Choose a valid social classification.');
  }
  const thread = await requireSocialThreadForReview(supabase, actor, socialThreadId);
  const version = Number.isInteger(expectedVersion) ? expectedVersion : thread.review_version;
  const { data, error } = await supabase.rpc('canary_review_social_thread', {
    p_actor_user_id: actor.id,
    p_social_thread_id: thread.id,
    p_action: action,
    p_expected_version: version,
    p_classification: action === 'classification' ? classification : null,
    p_reviewer_note: action === 'note' ? cleanSocialReviewerNote(reviewerNote) : null,
  });
  if (error) throw error;
  revalidatePath('/dashboard');
  return data;
}

export async function bulkReviewSocialThreads({ districtId, socialThreadIds, action }) {
  const { actor, admin: supabase } = await requireCanaryActor();
  assertCanaryReviewer(actor);
  assertDistrictAccess(actor, districtId);
  if (!['approve_official', 'promote'].includes(action)) throw new Error('Unsupported bulk social review action.');
  const ids = [...new Set((Array.isArray(socialThreadIds) ? socialThreadIds : []).map(String).filter(Boolean))];
  if (ids.length < 1 || ids.length > 250) throw new Error('Select between 1 and 250 social results.');

  const { data: rows, error: rowsError } = await supabase
    .from('social_threads')
    .select('id, district_id, social_account_id, platform, relationship_type, visibility_status')
    .in('id', ids);
  if (rowsError) throw rowsError;
  if ((rows ?? []).length !== ids.length || rows.some((row) => row.district_id !== districtId)) {
    throw new Error('Selection contains missing or cross-district social results.');
  }
  const accountIds = [...new Set(rows.map((row) => row.social_account_id).filter(Boolean))];
  const { data: officialAccounts, error: accountError } = accountIds.length > 0
    ? await supabase.from('social_accounts').select('id, district_id, platform, handle, profile_url, active').in('id', accountIds)
    : { data: [], error: null };
  if (accountError) throw accountError;
  const officialAccountKeys = new Set((officialAccounts ?? [])
    .filter((account) => account.active && (String(account.handle || '').trim() || String(account.profile_url || '').trim()))
    .map((account) => `${account.id}:${account.district_id}:${account.platform}`));
  const allEligible = action === 'approve_official'
    ? rows.every((row) => row.relationship_type === 'owned' && row.visibility_status === 'review'
      && officialAccountKeys.has(`${row.social_account_id}:${row.district_id}:${row.platform}`))
    : rows.every((row) => row.visibility_status === 'approved');
  if (!allEligible) throw new Error(action === 'approve_official'
    ? 'Bulk approval is limited to official district posts awaiting review.'
    : 'Only approved results can be promoted.');

  const { data, error } = await supabase.rpc('canary_bulk_review_social_threads', {
    p_actor_user_id: actor.id,
    p_district_id: districtId,
    p_social_thread_ids: ids,
    p_action: action,
  });
  if (error) throw error;
  revalidatePath('/dashboard');
  return Array.isArray(data) ? data[0] : data;
}

export async function addQuery({ query_text, district_id, district_name, geo_city, geo_state, geo_zip, channels }) {
  const { actor, admin: supabase } = await requireCanaryActor();
  const targetDistrictId = actor.isAdmin ? String(district_id || '').trim() : actor.districtId;
  if (!targetDistrictId) throw new Error('Choose a district before adding a query.');
  assertDistrictAccess(actor, targetDistrictId);

  const queryText = validateSearchQueryText(query_text);
  const queryChannel = actor.isAdmin && ['news', 'social', 'all'].includes(channels) ? channels : 'news';
  const { data: existingQueries, error: existingError } = await supabase
    .from('search_queries')
    .select('id, query_text, channels, active')
    .eq('district_id', targetDistrictId);
  if (existingError) throw existingError;

  const fingerprint = searchQueryFingerprint(queryText);
  const matchingQuery = (existingQueries || []).find((query) => query.channels === queryChannel && searchQueryFingerprint(query.query_text) === fingerprint);
  if (matchingQuery && matchingQuery.active !== false) throw new Error('That search query is already active.');

  const activeNewsQueries = (existingQueries || []).filter((query) => query.active !== false && query.channels === 'news').length;
  if (!actor.isAdmin && queryChannel === 'news' && activeNewsQueries >= CUSTOMER_SEARCH_QUERY_LIMIT) {
    throw new Error(`Your account can monitor up to ${CUSTOMER_SEARCH_QUERY_LIMIT} active news queries. Remove one before adding another.`);
  }

  const cleanLocation = (value, maxLength) => String(value || '').trim().slice(0, maxLength);
  const { data: district } = await supabase.from('districts').select('name').eq('id', targetDistrictId).maybeSingle();
  const queryValues = {
    query_text: queryText,
    district_id: targetDistrictId,
    district_name: district?.name || district_name || null,
    geo_city: cleanLocation(geo_city, 100),
    geo_state: cleanLocation(geo_state, 50),
    geo_zip: cleanLocation(geo_zip, 20),
    channels: queryChannel,
    active: true,
  };

  if (matchingQuery) {
    const { data, error } = await supabase
      .from('search_queries')
      .update(queryValues)
      .eq('id', matchingQuery.id)
      .select('id, query_text, district_id, district_name, geo_city, geo_state, geo_zip, channels, active, created_at')
      .single();
    if (error) throw error;
    revalidatePath('/dashboard');
    return data;
  }

  const { data, error } = await supabase
    .from('search_queries')
    .insert(queryValues)
    .select('id, query_text, district_id, district_name, geo_city, geo_state, geo_zip, channels, active, created_at')
    .single();
  if (error) throw error;
  revalidatePath('/dashboard');
  return data;
}

export async function deleteQuery(id) {
  const { actor, admin: supabase } = await requireCanaryActor();
  const { data: query } = await supabase.from('search_queries').select('district_id').eq('id', id).maybeSingle();
  if (!query) throw new Error('Search query not found.');
  assertDistrictAccess(actor, query?.district_id);
  const { error } = await supabase.from('search_queries').update({ active: false }).eq('id', id);
  if (error) throw error;
  revalidatePath('/dashboard');
}

export async function submitFeedback(formData) {
  const { actor, admin: supabase } = await requireCanaryActor();

  const message = formData.get('message');
  const requestedDistrictId = formData.get('district_id') || null;
  const districtId = actor.isAdmin ? requestedDistrictId : actor.districtId;
  assertDistrictAccess(actor, districtId);
  const districtName = formData.get('district_name') || null;
  const file = formData.get('photo');

  if (!message?.trim()) throw new Error('Message is required');

  let photoUrl = null;

  if (file && file.size > 0) {
    const ext = file.name.split('.').pop();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const bytes = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from('feedback-attachments')
      .upload(path, bytes, { contentType: file.type });
    if (uploadError) throw uploadError;
    const { data: urlData } = supabase.storage
      .from('feedback-attachments')
      .getPublicUrl(path);
    photoUrl = urlData.publicUrl;
  }

  const { data: feedback, error } = await supabase.from('feedback').insert({
    message: message.trim(),
    photo_url: photoUrl,
    district_id: districtId,
    district_name: districtName,
  }).select('*').single();
  if (error) throw error;

  if (!isClickUpConfigured()) return;

  try {
    const task = await createClickUpFeedbackTask(feedback);
    const { error: updateError } = await supabase
      .from('feedback')
      .update({
        status: 'clickup_synced',
        clickup_task_id: task?.id || null,
        clickup_task_url: task?.url || null,
        clickup_synced_at: new Date().toISOString(),
        clickup_sync_error: null,
      })
      .eq('id', feedback.id);
    if (updateError) {
      await supabase.from('feedback').update({ status: 'clickup_synced' }).eq('id', feedback.id);
    }
  } catch (clickupError) {
    const { error: updateError } = await supabase
      .from('feedback')
      .update({
        status: 'clickup_failed',
        clickup_sync_error: clickupError.message || 'Unknown ClickUp error',
      })
      .eq('id', feedback.id);
    if (updateError) {
      await supabase.from('feedback').update({ status: 'clickup_failed' }).eq('id', feedback.id);
    }
  }
}
