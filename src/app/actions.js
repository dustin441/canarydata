'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClickUpFeedbackTask, createClickUpOnboardingTask, isClickUpConfigured } from '@/lib/clickup';
import { revalidatePath } from 'next/cache';

function cleanFormValue(formData, key) {
  return String(formData.get(key) || '').trim();
}

function normalizeWebsite(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
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

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'CanaryDataTrialSetup/1.0 (+https://www.canarydata.media)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  const html = await response.text();
  return { url, html, text: cleanHtmlText(html), contentType };
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
  const city = cleanFormValue(formData, 'city');
  const state = cleanFormValue(formData, 'state');
  if (!organizationName) throw new Error('District or organization name is required');
  if (!website) throw new Error('Website is required');

  const pages = [];
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

  const combinedText = pages.map((page) => page.text).join('\n\n');
  const missionSnippets = findNearbySnippets(combinedText, ['mission', 'vision', 'values', 'beliefs', 'we believe', 'core values'], 4);
  const prioritySnippets = findNearbySnippets(combinedText, ['strategic plan', 'priority', 'priorities', 'goals', 'focus areas', 'board goals', 'portrait of a graduate'], 4);
  const discoveredSocials = extractSocialLinksFromPages(pages, website);
  const discoveredSchools = extractSchoolNames(combinedText);
  const sourceUrls = pages.map((page) => page.url).join('\n');
  const fetchError = errors.length ? errors.slice(0, 5).join('\n') : '';

  const confirmedProfile = {
    organization_name: organizationName,
    website,
    location: [city, state, cleanFormValue(formData, 'zip')].filter(Boolean).join(', '),
    social_handles: cleanFormValue(formData, 'social_handles') || discoveredSocials,
    keywords: cleanFormValue(formData, 'keywords') || buildKeywords({ organizationName, city, state, schoolNames: discoveredSchools }),
    school_names: cleanFormValue(formData, 'school_names') || discoveredSchools,
    known_exclusions: cleanFormValue(formData, 'known_exclusions'),
    mission_vision_values: missionSnippets.join('\n\n'),
    strategic_priorities: prioritySnippets.join('\n\n'),
    discovered_source_urls: sourceUrls,
    discovery_notes: pages.length
      ? `Canary reviewed ${pages.length} public page${pages.length === 1 ? '' : 's'}. Please approve or edit before review.${fetchError ? `\n\nPages needing manual review:\n${fetchError}` : ''}`
      : `Website discovery needs manual review.${fetchError ? `\n\n${fetchError}` : ''}`,
  };

  return {
    ok: true,
    discovered_profile: {
      website_fetched: pages.length > 0,
      fetch_error: fetchError || null,
      pages_reviewed: pages.map((page) => page.url),
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
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('news_stories')
    .update({ is_earned_media: value })
    .eq('id', id);
  if (error) throw error;
}

export async function saveNote(id, notes) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('news_stories')
    .update({ notes: notes || null })
    .eq('id', id);
  if (error) throw error;
}

export async function addQuery({ query_text, district_id, district_name, geo_city, geo_state, geo_zip, channels }) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('search_queries')
    .insert({
      query_text,
      district_id: district_id || null,
      district_name: district_name || null,
      geo_city: geo_city || '',
      geo_state: geo_state || '',
      geo_zip: geo_zip || '',
      channels: channels || 'news',
      active: true,
    })
    .select('id, query_text, district_id, district_name, geo_city, geo_state, geo_zip, channels, active, created_at')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteQuery(id) {
  const supabase = createAdminClient();
  const { error } = await supabase.from('search_queries').delete().eq('id', id);
  if (error) throw error;
}

export async function submitFeedback(formData) {
  const supabase = createAdminClient();

  const message = formData.get('message');
  const districtId = formData.get('district_id') || null;
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
