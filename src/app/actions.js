'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClickUpFeedbackTask, createClickUpOnboardingTask, createClickUpQueryReviewTask, isClickUpConfigured } from '@/lib/clickup';
import { revalidatePath } from 'next/cache';
import { canonicalizeStoryUrl, requireCorrectionReason } from '@/lib/storyCorrections.mjs';
import { CUSTOMER_SEARCH_QUERY_LIMIT, applySearchQuerySnapshotFilters, buildSearchQueryUpdate, hasActiveSearchQueryDuplicate, reconcileActiveSearchQueryWrite, searchQueryFingerprint, searchQuerySnapshot, validateSearchQueryText } from '@/lib/queryPolicy.mjs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { assertStrategicPlanFileSize } from '@/lib/onboarding-upload.mjs';
import { buildSocialCorrectionRpcArgs, requireSocialCorrectionExpectedVersion } from '@/lib/socialLifecycle.mjs';

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

const SOCIAL_CORRECTION_ACTIONS = new Set(['exclude', 'restore']);

const SOCIAL_AFFILIATE_TYPES = new Set(['school', 'athletics', 'fine_arts', 'cte', 'club', 'booster', 'foundation', 'pto_pta', 'program', 'other']);
const SOCIAL_AFFILIATE_VERIFICATION_SOURCES = new Set(['district', 'canary_admin', 'official_website']);

function cleanAffiliateText(value, label, maxLength, required = false) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (required && !text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} is too long.`);
  return text || null;
}



function customerSearchQuerySlotId(districtId, slotIndex) {
  const hex = createHash('sha256').update(`canary-search-query-slot:${districtId}:${slotIndex}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function requireSocialThreadForReview(supabase, actor, socialThreadId) {
  const { data: thread, error } = await supabase
    .from('social_threads')
    .select('id, district_id, social_account_id, platform, relationship_type, visibility_status, review_version')
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
    assertStrategicPlanFileSize(strategicPlanFile);
    try {
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

function feedbackTrackingColumnsUnavailable(error) {
  return ['42703', 'PGRST204'].includes(String(error?.code || ''))
    || /column .* does not exist|schema cache/i.test(String(error?.message || ''));
}

async function transitionFeedbackClickUpDispatch(supabase, { id, expectedStatus, status, task = null, errorMessage = null }) {
  const payload = {
    status,
    clickup_task_id: task?.id || null,
    clickup_task_url: task?.url || null,
    clickup_synced_at: task ? new Date().toISOString() : null,
    clickup_sync_error: errorMessage,
  };
  let { data: linked, error } = await supabase
    .from('feedback')
    .update(payload)
    .eq('id', id)
    .eq('status', expectedStatus)
    .select('id')
    .maybeSingle();
  if (error && feedbackTrackingColumnsUnavailable(error)) {
    ({ data: linked, error } = await supabase
      .from('feedback')
      .update({ status })
      .eq('id', id)
      .eq('status', expectedStatus)
      .select('id')
      .maybeSingle());
  }
  if (error) throw error;
  if (!linked) throw new Error('Lost feedback ClickUp dispatch ownership before recording the outcome.');
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

  const clickupConfigured = isClickUpConfigured();
  const leadDispatchStatus = clickupConfigured ? `lead_clickup_dispatching:${Date.now()}:${randomUUID()}` : 'lead_request';
  const { data: feedback, error } = await supabase.from('feedback').insert({
    message,
    district_name: lead.organization_name,
    district_id: null,
    status: leadDispatchStatus,
  }).select('*').single();

  if (error) throw error;

  if (clickupConfigured) {
    try {
      const task = await createClickUpFeedbackTask(feedback);
      await transitionFeedbackClickUpDispatch(supabase, { id: feedback.id, expectedStatus: leadDispatchStatus, status: 'lead_clickup_synced', task });
    } catch (clickupError) {
      console.error('Canary lead ClickUp dispatch failed', { status: clickupError?.status || null, message: clickupError?.message || 'Unknown ClickUp error' });
      const definiteRejection = Number.isInteger(clickupError.status)
        && clickupError.status >= 400
        && clickupError.status < 500
        && ![408, 425, 429].includes(clickupError.status);
      if (definiteRejection) {
        await transitionFeedbackClickUpDispatch(supabase, { id: feedback.id, expectedStatus: leadDispatchStatus, status: 'lead_clickup_failed', errorMessage: clickupError.message || 'Unknown ClickUp error' });
      }
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

  const clickupConfigured = isClickUpConfigured();
  let onboardingDispatchStatus = clickupConfigured ? `onboarding_clickup_dispatching:${Date.now()}:${randomUUID()}` : 'submitted';
  let saved = null;
  let dbError = null;
  try {
    const { data, error } = await supabase
      .from('onboarding_requests')
      .insert({ ...request, status: onboardingDispatchStatus })
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
      onboardingDispatchStatus = clickupConfigured ? `onboarding_clickup_dispatching:${Date.now()}:${randomUUID()}` : 'onboarding_request';
      const { data: feedbackFallback, error: fallbackError } = await supabase
        .from('feedback')
        .insert({
          message: fallbackMessage,
          district_name: request.organization_name,
          district_id: null,
          status: onboardingDispatchStatus,
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
  if (clickupConfigured) {
    try {
      clickupTask = await createClickUpOnboardingTask(saved);
      if (saved.id && saved.fallback_table === 'feedback') {
        await transitionFeedbackClickUpDispatch(supabase, { id: saved.id, expectedStatus: onboardingDispatchStatus, status: 'onboarding_clickup_synced', task: clickupTask });
      } else if (saved.id) {
        const { data: linked, error: updateError } = await supabase
          .from('onboarding_requests')
          .update({
            status: 'submitted',
            clickup_task_id: clickupTask?.id || null,
            clickup_task_url: clickupTask?.url || null,
            clickup_synced_at: new Date().toISOString(),
            clickup_sync_error: null,
          })
          .eq('id', saved.id)
          .eq('status', onboardingDispatchStatus)
          .select('id')
          .maybeSingle();
        if (updateError || !linked) throw updateError || new Error('Lost onboarding ClickUp dispatch ownership before linking the task.');
      }
    } catch (error) {
      clickupError = error;
      console.error('Canary onboarding ClickUp dispatch failed', { status: error?.status || null, message: error?.message || 'Unknown ClickUp error' });
      if (saved.id && saved.fallback_table === 'feedback') {
        const definiteRejection = Number.isInteger(error.status)
          && error.status >= 400
          && error.status < 500
          && ![408, 425, 429].includes(error.status);
        if (definiteRejection) {
          await transitionFeedbackClickUpDispatch(supabase, { id: saved.id, expectedStatus: onboardingDispatchStatus, status: 'onboarding_clickup_failed', errorMessage: error.message || 'Unknown ClickUp error' });
        }
      } else if (saved.id) {
        const definiteRejection = Number.isInteger(error.status)
          && error.status >= 400
          && error.status < 500
          && ![408, 425, 429].includes(error.status);
        if (definiteRejection) {
          await supabase
            .from('onboarding_requests')
            .update({ status: 'clickup_failed', clickup_sync_error: error.message || 'Unknown ClickUp error' })
            .eq('id', saved.id)
            .eq('status', onboardingDispatchStatus);
        }
      }
    }
  }

  if (!saved.id && !clickupTask) {
    throw new Error(dbError?.message || clickupError?.message || 'Unable to submit onboarding request');
  }

  return {
    ok: true,
    id: saved.id,
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

export async function reviewSocialThread({ socialThreadId, action, expectedVersion }) {
  const { actor, admin: supabase } = await requireCanaryActor();
  assertCanaryReviewer(actor);
  if (!SOCIAL_CORRECTION_ACTIONS.has(action)) throw new Error('Unsupported social correction action.');
  const lifecycleVersion = requireSocialCorrectionExpectedVersion(expectedVersion);
  const thread = await requireSocialThreadForReview(supabase, actor, socialThreadId);
  const { data, error } = await supabase.rpc('canary_apply_social_correction', buildSocialCorrectionRpcArgs({
    actorId: actor.id,
    districtId: thread.district_id,
    socialThreadId: thread.id,
    action,
    expectedVersion: lifecycleVersion,
  }));
  if (error) throw error;
  revalidatePath('/dashboard');
  return data;
}

export async function reviewSocialDiscoveryCandidate(input = {}) {
  const { actor, admin: supabase } = await requireCanaryActor();
  assertCanaryReviewer(actor);
  const districtId = cleanAffiliateText(input.districtId, 'District', 200, true);
  const candidateId = cleanAffiliateText(input.candidateId, 'Candidate', 100, true);
  const action = String(input.action || '').trim().toLowerCase();
  const expectedVersion = Number(input.expectedVersion);
  if (!['approve', 'reject'].includes(action)) throw new Error('Unsupported Social discovery action.');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error('Candidate version is required.');
  assertDistrictAccess(actor, districtId);
  const { data: candidate, error: candidateError } = await supabase
    .from('social_discovery_candidates')
    .select('id,district_id,status,review_version')
    .eq('id', candidateId)
    .eq('district_id', districtId)
    .maybeSingle();
  if (candidateError) throw candidateError;
  if (!candidate) throw new Error('Social discovery candidate not found.');
  if (candidate.status !== 'pending') throw new Error('Only pending Social discovery candidates can be reviewed.');
  if (candidate.review_version !== expectedVersion) throw new Error('Social discovery candidate changed; refresh and try again.');
  const { data, error } = await supabase.rpc('canary_review_social_discovery', {
    p_actor_user_id: actor.id,
    p_expected_district_id: districtId,
    p_candidate_id: candidateId,
    p_action: action,
    p_expected_version: expectedVersion,
    p_reviewer_note: cleanAffiliateText(input.reviewerNote, 'Reviewer note', 2000, true),
    p_idempotency_key: cleanAffiliateText(input.idempotencyKey || randomUUID(), 'Idempotency key', 128, true),
  });
  if (error) throw new Error(error.message || 'Unable to review Social discovery candidate.');
  revalidatePath('/dashboard/affiliates');
  revalidatePath('/dashboard');
  return Array.isArray(data) ? data[0] : data;
}

export async function claimSocialAffiliate(input = {}) {
  const { actor, admin: supabase } = await requireCanaryActor();
  assertCanaryReviewer(actor);
  const districtId = cleanAffiliateText(input.districtId, 'District', 200, true);
  assertDistrictAccess(actor, districtId);
  const affiliateType = String(input.affiliateType || '').trim().toLowerCase();
  const verificationSource = String(input.verificationSource || '').trim().toLowerCase();
  if (!SOCIAL_AFFILIATE_TYPES.has(affiliateType)) throw new Error('Unsupported affiliate type.');
  if (!SOCIAL_AFFILIATE_VERIFICATION_SOURCES.has(verificationSource)) throw new Error('Unsupported verification source.');
  const socialAccountId = cleanAffiliateText(input.socialAccountId, 'Social account', 100, true);
  const { data: account, error: accountError } = await supabase
    .from('social_accounts')
    .select('id, district_id, active, platform_account_id, handle')
    .eq('id', socialAccountId)
    .eq('district_id', districtId)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account) throw new Error('Social account not found for this district.');
  if (!account.platform_account_id && !String(account.handle || '').replace(/^@+/, '').trim()) throw new Error('Social account lacks an exact provider account ID or handle.');
  const { data, error } = await supabase.rpc('canary_claim_social_affiliate', {
    p_actor_user_id: actor.id,
    p_district_id: districtId,
    p_social_account_id: socialAccountId,
    p_affiliate_type: affiliateType,
    p_relationship_label: cleanAffiliateText(input.relationshipLabel, 'Relationship label', 120, true),
    p_verification_source: verificationSource,
    p_verification_note: cleanAffiliateText(input.verificationNote, 'Verification note', 2000),
    p_idempotency_key: cleanAffiliateText(input.idempotencyKey || randomUUID(), 'Idempotency key', 200, true),
  });
  if (error) throw new Error(error.message || 'Unable to claim affiliate account.');
  revalidatePath('/dashboard/affiliates');
  return Array.isArray(data) ? data[0] : data;
}

export async function revokeSocialAffiliate(input = {}) {
  const { actor, admin: supabase } = await requireCanaryActor();
  assertCanaryReviewer(actor);
  const districtId = cleanAffiliateText(input.districtId, 'District', 200, true);
  const affiliateClaimId = cleanAffiliateText(input.affiliateClaimId, 'Affiliate claim', 100, true);
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('Affiliate claim version is required.');
  assertDistrictAccess(actor, districtId);
  const { data: current, error: currentError } = await supabase
    .from('social_affiliate_claims')
    .select('id, district_id, status, claim_version')
    .eq('id', affiliateClaimId)
    .eq('district_id', districtId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw new Error('Affiliate claim not found.');
  if (current.status !== 'active') throw new Error('Affiliate claim is not active.');
  const { data, error } = await supabase.rpc('canary_revoke_social_affiliate', {
    p_actor_user_id: actor.id,
    p_district_id: districtId,
    p_affiliate_claim_id: affiliateClaimId,
    p_expected_version: expectedVersion,
    p_revocation_reason: cleanAffiliateText(input.revocationReason, 'Revocation reason', 1000, true),
    p_idempotency_key: cleanAffiliateText(input.idempotencyKey || randomUUID(), 'Idempotency key', 200, true),
  });
  if (error) throw new Error(error.message || 'Unable to revoke affiliate claim.');
  revalidatePath('/dashboard/affiliates');
  return Array.isArray(data) ? data[0] : data;
}

const SEARCH_QUERY_RETURN_COLUMNS = 'id, query_text, district_id, district_name, geo_city, geo_state, geo_zip, channels, active, created_at';
const SEARCH_QUERY_RETRY_ERROR = 'Queries changed while this request was saving. Refresh and try again.';

async function reconcileSearchQueryWrite({ supabase, writtenQuery, rollbackValues }) {
  return reconcileActiveSearchQueryWrite({
    writtenQuery,
    loadDistrictQueries: async () => {
      const { data, error } = await supabase
        .from('search_queries')
        .select(SEARCH_QUERY_RETURN_COLUMNS)
        .eq('district_id', writtenQuery.district_id);
      if (error) throw error;
      return data || [];
    },
    undoWrittenQuery: async (expectedWrite) => {
      let rollback = supabase
        .from('search_queries')
        .update(rollbackValues)
        .eq('id', writtenQuery.id)
        .eq('district_id', writtenQuery.district_id);
      rollback = applySearchQuerySnapshotFilters(rollback, expectedWrite);
      const { data, error } = await rollback.select('id').maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
  });
}

async function duplicateWriteError({ supabase, writtenQuery, rollbackValues, reconcileRollback = false }) {
  const reconciliation = await reconcileSearchQueryWrite({ supabase, writtenQuery, rollbackValues });
  if (!reconciliation.duplicate) return null;
  if (!reconciliation.reconciled) return SEARCH_QUERY_RETRY_ERROR;

  // Restoring an edited row's original fingerprint can race with a third writer
  // that claimed that fingerprint while the edit was in flight. Reconcile the
  // restoration as a second guarded write; if it now duplicates another active
  // row, deactivate only this row rather than leaving duplicate monitoring work.
  if (reconcileRollback && rollbackValues?.active === true) {
    const restoredQuery = { ...writtenQuery, ...rollbackValues };
    const restoredReconciliation = await reconcileSearchQueryWrite({
      supabase,
      writtenQuery: restoredQuery,
      rollbackValues: { active: false },
    });
    if (restoredReconciliation.duplicate && !restoredReconciliation.reconciled) {
      return SEARCH_QUERY_RETRY_ERROR;
    }
    if (restoredReconciliation.duplicate) {
      return 'That search query conflicted with another change while saving. Your edit was not kept, and this query was paused to prevent duplicate monitoring. Refresh before reactivating or adding it again.';
    }
  }

  return 'That search query became a duplicate while saving, so your change was not kept. Refresh and try a different query.';
}

function formatQueryReviewMessage({ action, before, after }) {
  const format = (query) => query ? [
    `Query: ${query.query_text || 'None'}`,
    `Channel: ${query.channels || 'news'}`,
    `Location: ${[query.geo_city, query.geo_state, query.geo_zip].filter(Boolean).join(', ') || 'None'}`,
    `Active in customer request list: ${query.active === false ? 'No' : 'Yes'}`,
  ].join('\n') : 'None';

  return [
    '[Query activation review]',
    `Requested action: ${action}`,
    '',
    'Previous customer request:',
    format(before),
    '',
    'Requested customer configuration:',
    format(after),
    '',
    'Canonical generated_queries monitoring was intentionally left unchanged pending Canary review and a controlled clean-results test.',
  ].join('\n');
}

async function queueCustomerQueryReview({ actor, supabase, action, before = null, after = null }) {
  if (actor.isAdmin) return null;
  const current = after || before;
  const districtId = current?.district_id || actor.districtId;
  const districtName = current?.district_name || null;
  const dispatchStatus = `query_review_dispatching:${Date.now()}:${randomUUID()}`;
  const { data: request, error: requestError } = await supabase
    .from('feedback')
    .insert({
      message: formatQueryReviewMessage({ action, before, after }),
      district_id: districtId,
      district_name: districtName,
      // Reserve direct ClickUp dispatch for this request. The retry worker only
      // claims pending rows, so it cannot race the server action.
      status: dispatchStatus,
    })
    .select('*')
    .single();

  if (requestError || !request) {
    console.error('Could not store customer query review request.', requestError?.message || 'No request row returned.');
    return { status: 'queue_failed' };
  }

  const review = {
    action,
    before,
    after,
    district_id: districtId,
    district_name: districtName,
    query_id: current?.id || null,
    request_id: request.id,
    created_at: request.created_at,
  };

  if (!isClickUpConfigured()) {
    await supabase.from('feedback').update({ status: 'query_review_pending' }).eq('id', request.id).eq('status', dispatchStatus);
    return { status: 'stored', request_id: request.id };
  }

  try {
    const task = await createClickUpQueryReviewTask(review);
    const { data: linked, error: updateError } = await supabase
      .from('feedback')
      .update({ status: task?.id ? `query_review_synced:${task.id}` : 'query_review_synced' })
      .eq('id', request.id)
      .eq('status', dispatchStatus)
      .select('id')
      .maybeSingle();
    if (updateError || !linked) {
      console.error('Could not save customer query review task status.', updateError?.message || 'Dispatch ownership changed before the task could be linked.');
      // The durable request already exists. Keep its dispatching state so no
      // retry can create a second task before reconciliation by request ID.
      return { status: 'stored', request_id: request.id };
    }
    return { status: 'queued', request_id: request.id };
  } catch (clickupError) {
    const definiteRejection = Number.isInteger(clickupError.status)
      && clickupError.status >= 400
      && clickupError.status < 500
      && ![408, 425, 429].includes(clickupError.status);
    if (definiteRejection) {
      await supabase
        .from('feedback')
        .update({ status: 'query_review_pending' })
        .eq('id', request.id)
        .eq('status', dispatchStatus);
    }
    console.error('Could not create customer query review task.', clickupError.message || 'Unknown ClickUp error');
    return { status: 'stored', request_id: request.id };
  }
}

async function rollbackSearchQueryAfterReviewFailure({ supabase, data, rollbackValues }) {
  if (!data?.id || !data?.district_id || !rollbackValues) return false;
  let rollback = supabase
    .from('search_queries')
    .update(rollbackValues)
    .eq('id', data.id)
    .eq('district_id', data.district_id);
  rollback = applySearchQuerySnapshotFilters(rollback, searchQuerySnapshot(data));
  const { data: restored, error } = await rollback
    .select(SEARCH_QUERY_RETURN_COLUMNS)
    .maybeSingle();
  if (error || !restored) return false;

  if (restored.active !== false) {
    const reconciliation = await reconcileSearchQueryWrite({
      supabase,
      writtenQuery: restored,
      rollbackValues: { active: false },
    });
    if (reconciliation.duplicate) return false;
  }
  return true;
}

async function finishSearchQueryMutation({ actor, supabase, data, action, before = null, after = data, rollbackValues = null }) {
  const canonicalReview = await queueCustomerQueryReview({ actor, supabase, action, before, after });
  if (canonicalReview?.status === 'queue_failed') {
    const rolledBack = await rollbackSearchQueryAfterReviewFailure({ supabase, data, rollbackValues });
    revalidatePath('/dashboard');
    return {
      error: rolledBack
        ? 'Canary could not save the required review request, so your query change was not kept. Please try again.'
        : 'Canary could not save the required review request or safely restore the prior query state. Refresh before making another change and use Send Feedback for follow-up.',
    };
  }
  revalidatePath('/dashboard');
  return canonicalReview ? { ...data, canonical_review: canonicalReview } : data;
}

export async function addQuery({ query_text, district_id, district_name, geo_city, geo_state, geo_zip, channels }) {
  const { actor, admin: supabase } = await requireCanaryActor();
  const targetDistrictId = actor.isAdmin ? String(district_id || '').trim() : actor.districtId;
  if (!targetDistrictId) return { error: 'Choose a district before adding a query.' };
  assertDistrictAccess(actor, targetDistrictId);

  let queryText;
  try {
    queryText = validateSearchQueryText(query_text);
  } catch (error) {
    return { error: error.message };
  }
  const queryChannel = actor.isAdmin && ['news', 'social', 'all'].includes(channels) ? channels : 'news';
  const { data: existingQueries, error: existingError } = await supabase
    .from('search_queries')
    .select(SEARCH_QUERY_RETURN_COLUMNS)
    .eq('district_id', targetDistrictId);
  if (existingError) throw existingError;

  const fingerprint = searchQueryFingerprint(queryText);
  const matchingQuery = (existingQueries || []).find((query) => query.channels === queryChannel && searchQueryFingerprint(query.query_text) === fingerprint);
  if (matchingQuery && matchingQuery.active !== false) return { error: 'That search query is already active.' };

  const activeNewsQueries = (existingQueries || []).filter((query) => query.active !== false && query.channels === 'news').length;
  if (!actor.isAdmin && queryChannel === 'news' && activeNewsQueries >= CUSTOMER_SEARCH_QUERY_LIMIT) {
    return { error: `Your account can monitor up to ${CUSTOMER_SEARCH_QUERY_LIMIT} active news queries. Remove one before adding another.` };
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

  if (actor.isAdmin && matchingQuery) {
    let reactivate = supabase
      .from('search_queries')
      .update(queryValues)
      .eq('id', matchingQuery.id)
      .eq('district_id', targetDistrictId);
    reactivate = applySearchQuerySnapshotFilters(reactivate, searchQuerySnapshot(matchingQuery));
    const { data, error } = await reactivate
      .select(SEARCH_QUERY_RETURN_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { error: SEARCH_QUERY_RETRY_ERROR };
    const duplicateError = await duplicateWriteError({ supabase, writtenQuery: data, rollbackValues: { active: false } });
    if (duplicateError) return { error: duplicateError };
    return finishSearchQueryMutation({ actor, supabase, data, action: 'add' });
  }

  if (!actor.isAdmin) {
    const activeIds = new Set((existingQueries || []).filter((query) => query.active !== false).map((query) => query.id));
    const slotIds = Array.from({ length: CUSTOMER_SEARCH_QUERY_LIMIT }, (_, index) => customerSearchQuerySlotId(targetDistrictId, index));
    const slotId = slotIds.find((id) => !activeIds.has(id));
    if (!slotId) return { error: `Your account can monitor up to ${CUSTOMER_SEARCH_QUERY_LIMIT} active news queries. Remove one before adding another.` };

    const existingSlot = (existingQueries || []).find((query) => query.id === slotId);
    if (existingSlot) {
      let claimSlot = supabase
        .from('search_queries')
        .update(queryValues)
        .eq('id', slotId)
        .eq('district_id', targetDistrictId);
      claimSlot = applySearchQuerySnapshotFilters(claimSlot, searchQuerySnapshot(existingSlot));
      const { data, error } = await claimSlot
        .select(SEARCH_QUERY_RETURN_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { error: SEARCH_QUERY_RETRY_ERROR };
      const duplicateError = await duplicateWriteError({ supabase, writtenQuery: data, rollbackValues: { active: false } });
      if (duplicateError) return { error: duplicateError };
      return finishSearchQueryMutation({ actor, supabase, data, action: 'add', rollbackValues: searchQuerySnapshot(existingSlot) });
    }

    const { data, error } = await supabase
      .from('search_queries')
      .insert({ ...queryValues, id: slotId })
      .select(SEARCH_QUERY_RETURN_COLUMNS)
      .single();
    if (error?.code === '23505') return { error: SEARCH_QUERY_RETRY_ERROR };
    if (error) throw error;
    const duplicateError = await duplicateWriteError({ supabase, writtenQuery: data, rollbackValues: { active: false } });
    if (duplicateError) return { error: duplicateError };
    return finishSearchQueryMutation({ actor, supabase, data, action: 'add', rollbackValues: { active: false } });
  }

  const { data, error } = await supabase
    .from('search_queries')
    .insert(queryValues)
    .select(SEARCH_QUERY_RETURN_COLUMNS)
    .single();
  if (error) throw error;
  const duplicateError = await duplicateWriteError({ supabase, writtenQuery: data, rollbackValues: { active: false } });
  if (duplicateError) return { error: duplicateError };
  return finishSearchQueryMutation({ actor, supabase, data, action: 'add' });
}

export async function updateQuery(changes) {
  const { actor, admin: supabase } = await requireCanaryActor();
  const id = String(changes?.id || '').trim();
  if (!id) return { error: 'Search query not found.' };

  let existingLookup = supabase
    .from('search_queries')
    .select('id, query_text, district_id, district_name, geo_city, geo_state, geo_zip, channels, active, created_at')
    .eq('id', id);
  if (!actor.isAdmin) existingLookup = existingLookup.eq('district_id', actor.districtId);
  const { data: existingQuery, error: existingError } = await existingLookup.maybeSingle();
  if (existingError) throw existingError;
  if (!existingQuery) return { error: 'Search query not found.' };

  let queryValues;
  let originalSnapshot;
  try {
    queryValues = buildSearchQueryUpdate({ actor, existingQuery, changes });
    originalSnapshot = searchQuerySnapshot(changes?.original);
  } catch (error) {
    return { error: error.message };
  }

  const { data: districtQueries, error: districtQueriesError } = await supabase
    .from('search_queries')
    .select('id, query_text, channels, active')
    .eq('district_id', existingQuery.district_id);
  if (districtQueriesError) throw districtQueriesError;
  if (hasActiveSearchQueryDuplicate(districtQueries, { id, ...queryValues })) {
    return { error: 'That search query is already active.' };
  }

  let update = supabase
    .from('search_queries')
    .update(queryValues)
    .eq('id', id)
    .eq('district_id', existingQuery.district_id);
  update = applySearchQuerySnapshotFilters(update, originalSnapshot);
  const { data, error } = await update
    .select(SEARCH_QUERY_RETURN_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { error: SEARCH_QUERY_RETRY_ERROR };
  const duplicateError = await duplicateWriteError({
    supabase,
    writtenQuery: data,
    rollbackValues: originalSnapshot,
    reconcileRollback: true,
  });
  if (duplicateError) return { error: duplicateError };
  return finishSearchQueryMutation({ actor, supabase, data, action: 'update', before: existingQuery, rollbackValues: originalSnapshot });
}

export async function deleteQuery(id) {
  const { actor, admin: supabase } = await requireCanaryActor();
  const { data: query } = await supabase
    .from('search_queries')
    .select('id, query_text, district_id, district_name, geo_city, geo_state, geo_zip, channels, active, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!query) throw new Error('Search query not found.');
  assertDistrictAccess(actor, query?.district_id);
  if (!actor.isAdmin && query.channels !== 'news') throw new Error('Only Canary administrators can change advanced monitoring queries.');
  if (query.active !== true) return { error: 'That search query is already removed. Refresh before making another change.' };
  let deactivate = supabase
    .from('search_queries')
    .update({ active: false })
    .eq('id', id)
    .eq('district_id', query.district_id);
  deactivate = applySearchQuerySnapshotFilters(deactivate, searchQuerySnapshot(query));
  const { data, error } = await deactivate
    .select(SEARCH_QUERY_RETURN_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { error: SEARCH_QUERY_RETRY_ERROR };
  return finishSearchQueryMutation({ actor, supabase, data, action: 'remove', before: query, after: data, rollbackValues: searchQuerySnapshot(query) });
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

  const clickupConfigured = isClickUpConfigured();
  const dispatchStatus = clickupConfigured ? `clickup_dispatching:${Date.now()}:${randomUUID()}` : null;
  const { data: feedback, error } = await supabase.from('feedback').insert({
    message: message.trim(),
    photo_url: photoUrl,
    district_id: districtId,
    district_name: districtName,
    status: dispatchStatus,
  }).select('*').single();
  if (error) throw error;

  if (!clickupConfigured) return;

  try {
    const task = await createClickUpFeedbackTask(feedback);
    await transitionFeedbackClickUpDispatch(supabase, { id: feedback.id, expectedStatus: dispatchStatus, status: 'clickup_synced', task });
  } catch (clickupError) {
    console.error('Canary feedback ClickUp dispatch failed', { status: clickupError?.status || null, message: clickupError?.message || 'Unknown ClickUp error' });
    const definiteRejection = Number.isInteger(clickupError.status)
      && clickupError.status >= 400
      && clickupError.status < 500
      && ![408, 425, 429].includes(clickupError.status);
    if (definiteRejection) {
      await transitionFeedbackClickUpDispatch(supabase, {
        id: feedback.id,
        expectedStatus: dispatchStatus,
        status: 'clickup_failed',
        errorMessage: clickupError.message || 'Unknown ClickUp error',
      });
    }
  }
}
