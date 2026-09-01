import { createAdminClient } from '@/lib/supabase/admin';
import { buildCollectionHealth, buildSocialCollectionHealth } from '@/lib/collectionHealth.mjs';
import { buildSocialAffiliatePreview } from '@/lib/social-affiliate-preview';
import { mergeSocialProviderObservationMetadata } from '@/lib/social.mjs';

const ARTICLE_COLUMNS = 'id, created_at, date, headline, summary, source, source_type, canary_score, tags, notes, is_earned_media, communications_earned, communications_earned_updated_at, communications_earned_updated_by, is_perched, link, district_id, innovation_reason, recommendation, source_query, canonical_url, visibility_status, manual_override, correction_version';
const ARTICLE_PAGE_SIZE = 1000;

export async function getArticles(districtId = null) {
  const supabase = createAdminClient();
  const allArticles = [];

  for (let from = 0; ; from += ARTICLE_PAGE_SIZE) {
    let query = supabase
      .from('news_stories')
      .select(ARTICLE_COLUMNS)
      .eq('visibility_status', 'active')
      .order('date', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + ARTICLE_PAGE_SIZE - 1);

    if (districtId) {
      query = query.eq('district_id', districtId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const page = data ?? [];
    allArticles.push(...page);

    if (page.length < ARTICLE_PAGE_SIZE) break;
  }

  return allArticles;
}

export async function getExcludedStories(districtId = null) {
  const supabase = createAdminClient();
  let query = supabase
    .from('news_stories')
    .select(ARTICLE_COLUMNS)
    .eq('visibility_status', 'excluded')
    .order('created_at', { ascending: false })
    .limit(250);
  if (districtId) query = query.eq('district_id', districtId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getStoryCorrectionEvents(districtId = null) {
  const supabase = createAdminClient();
  let query = supabase
    .from('story_correction_events')
    .select('id, correlation_id, district_id, story_id, action, reason, before_state, after_state, reverses_event_id, resulting_version, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (districtId) query = query.eq('district_id', districtId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getDistricts() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('districts')
    .select('id, name')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function getStrategicProfiles(districtId = null) {
  const supabase = createAdminClient();
  let query = supabase
    .from('strategic_profiles')
    .select('id, district_id, source_confidence, mission, vision, values, source_urls, last_reviewed_at, updated_at')
    .order('district_id');
  if (districtId) query = query.eq('district_id', districtId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getStrategicPriorities(districtId = null) {
  const supabase = createAdminClient();
  let query = supabase
    .from('strategic_priorities')
    .select('id, district_id, profile_id, label, description, aliases, source_urls, confidence, active, updated_at')
    .eq('active', true)
    .order('district_id')
    .order('label');
  if (districtId) query = query.eq('district_id', districtId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getSocialSources(districtId = null) {
  const supabase = createAdminClient();
  let query = supabase
    .from('social_accounts')
    .select('id, district_id, provider, platform, platform_account_id, display_name, profile_url, handle, active, authorization_mode, connection_status, metadata, last_successful_sync_at, created_at')
    .eq('active', true)
    .order('district_id')
    .order('platform');
  if (districtId) query = query.eq('district_id', districtId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((account) => ({
    ...account,
    url: account.profile_url,
  }));
}

export async function getSocialAffiliateClaims(districtId) {
  if (!districtId || districtId === 'All') throw new Error('A specific district is required.');
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('social_affiliate_claims')
    .select('id, district_id, social_account_id, affiliate_type, relationship_label, verification_source, verification_note, status, claimed_by, claimed_at, verified_by, verified_at, revoked_by, revoked_at, revocation_reason, claim_version, created_at, updated_at, social_accounts!inner(id, platform, platform_account_id, handle, display_name, profile_url, active)')
    .eq('district_id', districtId)
    .order('status')
    .order('relationship_label');
  if (error) throw error;
  return data ?? [];
}

export async function getSocialAffiliateAccounts(districtId) {
  if (!districtId || districtId === 'All') throw new Error('A specific district is required.');
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('social_accounts')
    .select('id, district_id, provider, platform, platform_account_id, display_name, profile_url, handle, active, authorization_mode, connection_status, metadata, last_successful_sync_at, created_at')
    .eq('district_id', districtId)
    .order('active', { ascending: false })
    .order('platform');
  if (error) throw error;
  return data ?? [];
}

export async function getSocialAffiliatePreviews(districtId, claims = null) {
  if (!districtId || districtId === 'All') throw new Error('A specific district is required.');
  const supabase = createAdminClient();
  const scopedClaims = claims ?? await getSocialAffiliateClaims(districtId);
  const activeClaims = scopedClaims.filter((claim) => claim.status === 'active');
  if (activeClaims.length === 0) return [];
  const threads = [];
  for (let from = 0; ; from += SOCIAL_THREAD_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('social_threads')
      .select('id, district_id, platform, author_handle, author_name, headline, canonical_url, published_at, relationship_type, visibility_status, comment_count, reply_count, reaction_count, share_count, view_count, engagement_total')
      .eq('district_id', districtId)
      .order('published_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + SOCIAL_THREAD_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    threads.push(...page);
    if (page.length < SOCIAL_THREAD_PAGE_SIZE) break;
  }
  return activeClaims.map((claim) => buildSocialAffiliatePreview({ claim, threads }));
}

const SOCIAL_THREAD_COLUMNS = 'id, district_id, social_account_id, provider, platform, external_thread_id, canonical_url, relationship_type, author_name, author_handle, headline, body, summary, recommendation, published_at, comment_count, reply_count, reaction_count, share_count, view_count, engagement_total, sentiment, risk_level, canary_score, tags, strategic_alignment, matched_terms, match_reason, identity_confidence, visibility_status, reviewer_note, review_version, reviewed_at, reviewed_by, provider_metadata, created_at, updated_at';
const SOCIAL_THREAD_PAGE_SIZE = 1000;
const SOCIAL_PROVIDER_OBSERVATION_PAGE_SIZE = 1000;
const SOCIAL_METRIC_SNAPSHOT_COLUMNS = 'id, district_id, provider_account_link_id, social_thread_id, provider, platform, metric_scope, provider_object_id, provider_metric_name, normalized_metric_name, metric_variant, period, period_start_at, period_end_at, source_scope, availability, metric_value, breakdown, effective_at, observed_at';
const SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE = 1000;
const SOCIAL_METRIC_LINK_BATCH_SIZE = 100;
const SOCIAL_METRIC_HISTORY_DAYS = 95;
const SOCIAL_REVIEW_EVENT_COLUMNS = 'id, batch_id, district_id, social_thread_id, actor_user_id, action, before_state, after_state, resulting_version, created_at';
const SOCIAL_REVIEW_EVENT_PAGE_SIZE = 1000;

export function buildEligibleSocialMetricLinkScope(links = [], assets = []) {
  const assetByDistrictAndId = new Map((assets ?? [])
    .filter((asset) => asset?.id && asset?.district_id && asset.active === true && asset.selected === true)
    .map((asset) => [`${asset.district_id}:${asset.id}`, asset]));
  const eligibleLinkIds = [];
  const accountIdentityByLink = new Map();

  for (const link of links ?? []) {
    if (!link?.id || !link?.district_id || !link?.provider_asset_id) continue;
    const asset = assetByDistrictAndId.get(`${link.district_id}:${link.provider_asset_id}`);
    if (!asset) continue;
    eligibleLinkIds.push(link.id);
    accountIdentityByLink.set(link.id, {
      name: asset.name || null,
      handle: asset.handle || null,
      profileUrl: asset.profile_url || null,
      platform: asset.platform || null,
    });
  }

  return { eligibleLinkIds, accountIdentityByLink };
}

async function loadEligibleSocialMetricLinkScope(supabase, activeLinks, districtId = null) {
  const eligibleLinkIds = [];
  const accountIdentityByLink = new Map();

  for (let linkOffset = 0; linkOffset < activeLinks.length; linkOffset += SOCIAL_METRIC_LINK_BATCH_SIZE) {
    const linkBatch = activeLinks.slice(linkOffset, linkOffset + SOCIAL_METRIC_LINK_BATCH_SIZE);
    const assetIds = [...new Set(linkBatch.map((link) => link.provider_asset_id).filter(Boolean))];
    if (!assetIds.length) continue;
    let assetQuery = supabase
      .from('social_provider_assets')
      .select('id,district_id,name,handle,profile_url,platform,active,selected')
      .eq('active', true)
      .eq('selected', true)
      .in('id', assetIds);
    if (districtId) assetQuery = assetQuery.eq('district_id', districtId);
    const { data: assets, error: assetError } = await assetQuery;
    if (assetError) throw assetError;

    const eligibleBatch = buildEligibleSocialMetricLinkScope(linkBatch, assets);
    eligibleLinkIds.push(...eligibleBatch.eligibleLinkIds);
    for (const [linkId, identity] of eligibleBatch.accountIdentityByLink) {
      accountIdentityByLink.set(linkId, identity);
    }
  }

  return { eligibleLinkIds, accountIdentityByLink };
}

export async function readAllSocialProviderObservations(supabase, threadIds = []) {
  const ids = [...new Set((threadIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const observations = [];
  for (let from = 0; ; from += SOCIAL_PROVIDER_OBSERVATION_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('social_thread_provider_observations')
      .select('id, social_thread_id, provider_metadata, observed_at')
      .in('social_thread_id', ids)
      .eq('provider', 'meta')
      .order('observed_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + SOCIAL_PROVIDER_OBSERVATION_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    observations.push(...page);
    if (page.length < SOCIAL_PROVIDER_OBSERVATION_PAGE_SIZE) break;
  }
  return observations;
}

export async function getSocialThreads(districtId = null, includeReview = false) {
  const supabase = createAdminClient();
  const threads = [];
  for (let from = 0; ; from += SOCIAL_THREAD_PAGE_SIZE) {
    let query = supabase
      .from('social_threads')
      .select(SOCIAL_THREAD_COLUMNS)
      .in('visibility_status', includeReview ? ['active', 'excluded'] : ['active'])
      .order('published_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + SOCIAL_THREAD_PAGE_SIZE - 1);
    if (districtId) query = query.eq('district_id', districtId);
    const { data, error } = await query;
    if (error) throw error;
    const page = data ?? [];
    threads.push(...page);
    if (page.length < SOCIAL_THREAD_PAGE_SIZE) break;
  }

  if (threads.length === 0) return threads;

  const comments = [];
  // Keep representative-comment reads bounded without serializing one request
  // for every 100 Social rows on the global admin dashboard.
  for (let groupStart = 0; groupStart < threads.length; groupStart += 400) {
    const pages = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
      const start = groupStart + (index * 100);
      const threadIds = threads.slice(start, start + 100).map((thread) => thread.id);
      if (threadIds.length === 0) return [];
      const { data: commentPage, error: commentError } = await supabase
        .from('social_comments')
        .select('id, social_thread_id, author_name, body, published_at, reaction_count, is_representative')
        .in('social_thread_id', threadIds)
        .eq('is_representative', true)
        .order('published_at', { ascending: false })
        .limit(1000);
      if (commentError) throw commentError;
      return commentPage ?? [];
    }));
    comments.push(...pages.flat());
  }

  const commentsByThread = new Map();
  comments.forEach((comment) => {
    const current = commentsByThread.get(comment.social_thread_id) ?? [];
    if (current.length < 3) current.push(comment);
    commentsByThread.set(comment.social_thread_id, current);
  });

  const providerObservations = [];
  for (let groupStart = 0; groupStart < threads.length; groupStart += 400) {
    const pages = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
      const start = groupStart + (index * 100);
      const threadIds = threads.slice(start, start + 100).map((thread) => thread.id);
      return readAllSocialProviderObservations(supabase, threadIds);
    }));
    providerObservations.push(...pages.flat());
  }

  return mergeSocialProviderObservationMetadata(threads, providerObservations).map((thread) => ({
    ...thread,
    social_comments: commentsByThread.get(thread.id) ?? [],
  }));
}

export async function getSocialMetricSnapshots(districtId = null) {
  const supabase = createAdminClient();
  const activeLinks = [];
  for (let from = 0; ; from += SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE) {
    let linkQuery = supabase
      .from('social_provider_account_links')
      .select('id,district_id,provider_asset_id')
      .eq('provider', 'meta')
      .eq('active', true)
      .order('id', { ascending: true })
      .range(from, from + SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE - 1);
    if (districtId) linkQuery = linkQuery.eq('district_id', districtId);
    const { data, error: linkError } = await linkQuery;
    if (linkError) throw linkError;
    const page = data ?? [];
    activeLinks.push(...page);
    if (page.length < SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE) break;
  }
  if (!activeLinks.length) return [];

  const { eligibleLinkIds, accountIdentityByLink } = await loadEligibleSocialMetricLinkScope(supabase, activeLinks, districtId);
  if (!eligibleLinkIds.length) return [];

  const snapshots = [];
  for (let linkOffset = 0; linkOffset < eligibleLinkIds.length; linkOffset += SOCIAL_METRIC_LINK_BATCH_SIZE) {
    const linkBatch = eligibleLinkIds.slice(linkOffset, linkOffset + SOCIAL_METRIC_LINK_BATCH_SIZE);
    for (let from = 0; ; from += SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE) {
      let query = supabase
        .from('canary_latest_social_metric_snapshots')
        .select(SOCIAL_METRIC_SNAPSHOT_COLUMNS)
        .in('provider_account_link_id', linkBatch)
        .order('effective_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE - 1);
      if (districtId) query = query.eq('district_id', districtId);
      const { data, error } = await query;
      if (error) throw error;
      const page = data ?? [];
      snapshots.push(...page.map((row) => ({ ...row, account_identity: accountIdentityByLink.get(row.provider_account_link_id) || null })));
      if (page.length < SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE) break;
    }
  }
  return snapshots;
}

export async function getSocialMetricHistory(districtId, asOf = new Date()) {
  if (!districtId || districtId === 'All') return [];
  const requestedAsOf = new Date(asOf);
  if (!Number.isFinite(requestedAsOf.getTime())) throw new Error('A valid Social metric history as-of date is required.');
  const historyEnd = new Date(Date.UTC(
    requestedAsOf.getUTCFullYear(),
    requestedAsOf.getUTCMonth(),
    requestedAsOf.getUTCDate(),
  ));
  const historyStart = new Date(historyEnd.getTime() - (SOCIAL_METRIC_HISTORY_DAYS * 86_400_000));
  const supabase = createAdminClient();
  const activeLinks = [];
  for (let from = 0; ; from += SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('social_provider_account_links')
      .select('id,district_id,provider_asset_id')
      .eq('provider', 'meta').eq('active', true)
      .eq('district_id', districtId)
      .order('id', { ascending: true })
      .range(from, from + SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    activeLinks.push(...page);
    if (page.length < SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE) break;
  }
  if (!activeLinks.length) return [];

  const { eligibleLinkIds, accountIdentityByLink } = await loadEligibleSocialMetricLinkScope(supabase, activeLinks, districtId);
  if (!eligibleLinkIds.length) return [];

  const history = [];
  for (let linkOffset = 0; linkOffset < eligibleLinkIds.length; linkOffset += SOCIAL_METRIC_LINK_BATCH_SIZE) {
    const linkBatch = eligibleLinkIds.slice(linkOffset, linkOffset + SOCIAL_METRIC_LINK_BATCH_SIZE);
    for (let from = 0; ; from += SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('social_provider_metric_snapshots')
        .select(SOCIAL_METRIC_SNAPSHOT_COLUMNS)
        .eq('district_id', districtId)
        .eq('metric_scope', 'account')
        .in('provider_account_link_id', linkBatch)
        .gte('effective_at', historyStart.toISOString())
        .lt('effective_at', historyEnd.toISOString())
        .order('effective_at', { ascending: true })
        .order('observed_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE - 1);
      if (error) throw error;
      const page = data ?? [];
      history.push(...page.map((row) => ({
        ...row,
        account_identity: accountIdentityByLink.get(row.provider_account_link_id) || null,
      })));
      if (page.length < SOCIAL_METRIC_SNAPSHOT_PAGE_SIZE) break;
    }
  }
  return history;
}

export async function readAllSocialReviewEvents(supabase, districtId = null) {
  const events = [];
  for (let from = 0; ; from += SOCIAL_REVIEW_EVENT_PAGE_SIZE) {
    let query = supabase
      .from('social_review_events')
      .select(SOCIAL_REVIEW_EVENT_COLUMNS)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + SOCIAL_REVIEW_EVENT_PAGE_SIZE - 1);
    if (districtId) query = query.eq('district_id', districtId);
    const { data, error } = await query;
    if (error) throw error;
    const page = data ?? [];
    events.push(...page);
    if (page.length < SOCIAL_REVIEW_EVENT_PAGE_SIZE) break;
  }
  return events;
}

export async function getSocialReviewEvents(districtId = null) {
  return readAllSocialReviewEvents(createAdminClient(), districtId);
}

export async function getRecentSocialReviewEvents(districtId = null) {
  const supabase = createAdminClient();
  let query = supabase
    .from('social_review_events')
    .select(SOCIAL_REVIEW_EVENT_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(500);
  if (districtId) query = query.eq('district_id', districtId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function updateArticleNote(id, notes) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('news_stories')
    .update({ notes })
    .eq('id', id);
  if (error) throw error;
}

export async function toggleEarnedMedia(id, value) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('news_stories')
    .update({ is_earned_media: value })
    .eq('id', id);
  if (error) throw error;
}

export async function getClients() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('client_credentials')
    .select('district_id, first_name, last_name, email, temp_password, created_at')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function getCollectionHealth(districts, districtId = null) {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const readRecent = async (table, columns, timestampColumn) => {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      let query = supabase
        .from(table)
        .select(columns)
        .gte(timestampColumn, cutoff)
        .order(timestampColumn, { ascending: false })
        .order('district_id', { ascending: true })
        .range(from, from + 999);
      if (districtId) query = query.eq('district_id', districtId);
      const { data, error } = await query;
      if (error) throw error;
      const page = data ?? [];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  };
  const [rawResults, candidates, stories] = await Promise.all([
    readRecent('raw_search_results', 'district_id, collected_at', 'collected_at'),
    readRecent('story_candidates', 'district_id, evaluated_at', 'evaluated_at'),
    readRecent('news_stories', 'district_id, created_at', 'created_at'),
  ]);
  const scopedDistricts = districtId ? districts.filter((district) => district.id === districtId) : districts;
  return buildCollectionHealth({ districts: scopedDistricts, rawResults, candidates, stories });
}

export async function getSocialCollectionHealth(districts, districtId = null) {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const readPages = async (table, columns, configure) => {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      let query = configure(supabase.from(table).select(columns));
      if (districtId) query = query.eq('district_id', districtId);
      const { data, error } = await query.range(from, from + 999);
      if (error) throw error;
      const page = data ?? [];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  };
  const [socialQueries, socialRuns, socialAccounts] = await Promise.all([
    readPages('search_queries', 'id,district_id,channels,active', (query) => query.eq('channels', 'social').eq('active', true).order('district_id').order('id')),
    readPages('social_collection_runs', 'id,district_id,status,started_at,completed_at,raw_items,accepted_threads,error_code,diagnostics', (query) => query.gte('started_at', cutoff).contains('diagnostics', { lane: 'all_district_public_facebook_v1' }).order('started_at', { ascending: false }).order('id', { ascending: false })),
    readPages('social_accounts', 'id,district_id,active', (query) => query.eq('active', true).order('district_id').order('id')),
  ]);
  const scopedDistricts = districtId ? districts.filter((district) => district.id === districtId) : districts;
  return buildSocialCollectionHealth({ districts: scopedDistricts, socialQueries, socialRuns, socialAccounts });
}

export async function getQueries(districtId = null) {
  const supabase = createAdminClient();
  let query = supabase
    .from('search_queries')
    .select('id, query_text, district_id, district_name, geo_city, geo_state, geo_zip, channels, active, created_at')
    .eq('active', true)
    .order('district_id')
    .order('query_text');
  if (districtId) query = query.eq('district_id', districtId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getPendingSocialDiscoveryCandidates(districtId) {
  if (!districtId || districtId === 'All') throw new Error('A specific district is required.');
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('social_discovery_candidates')
    .select('id,district_id,provider,platform,external_thread_id,canonical_url,relationship_type,candidate_payload,status,review_version,source_workflow_id,source_execution_id,first_seen_at,last_seen_at')
    .eq('district_id', districtId)
    .eq('status', 'pending')
    .order('last_seen_at', { ascending: false })
    .limit(100);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return { available: false, candidates: [] };
    throw error;
  }
  return { available: true, candidates: data ?? [] };
}
