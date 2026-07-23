import { createAdminClient } from '@/lib/supabase/admin';

const ARTICLE_COLUMNS = 'id, created_at, date, headline, summary, source, source_type, canary_score, tags, notes, is_earned_media, is_perched, link, district_id, innovation_reason, recommendation, source_query, canonical_url, visibility_status, manual_override, correction_version';
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

const SOCIAL_THREAD_COLUMNS = 'id, district_id, social_account_id, provider, platform, external_thread_id, canonical_url, relationship_type, author_name, author_handle, headline, body, summary, recommendation, published_at, comment_count, reply_count, reaction_count, share_count, view_count, engagement_total, sentiment, risk_level, canary_score, tags, strategic_alignment, matched_terms, match_reason, identity_confidence, visibility_status, provider_metadata, created_at, updated_at';
const SOCIAL_THREAD_PAGE_SIZE = 1000;

export async function getSocialThreads(districtId = null, includeReview = false) {
  const supabase = createAdminClient();
  const threads = [];
  for (let from = 0; ; from += SOCIAL_THREAD_PAGE_SIZE) {
    let query = supabase
      .from('social_threads')
      .select(SOCIAL_THREAD_COLUMNS)
      .in('visibility_status', includeReview ? ['active', 'review'] : ['active'])
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
  for (let start = 0; start < threads.length; start += 100) {
    const threadIds = threads.slice(start, start + 100).map((thread) => thread.id);
    const { data: commentPage, error: commentError } = await supabase
      .from('social_comments')
      .select('id, social_thread_id, author_name, body, published_at, reaction_count, is_representative')
      .in('social_thread_id', threadIds)
      .eq('is_representative', true)
      .order('published_at', { ascending: false })
      .limit(1000);
    if (commentError) throw commentError;
    comments.push(...(commentPage ?? []));
  }

  const commentsByThread = new Map();
  comments.forEach((comment) => {
    const current = commentsByThread.get(comment.social_thread_id) ?? [];
    if (current.length < 3) current.push(comment);
    commentsByThread.set(comment.social_thread_id, current);
  });

  return threads.map((thread) => ({
    ...thread,
    social_comments: commentsByThread.get(thread.id) ?? [],
  }));
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

export async function getQueries(districtId = null) {
  const supabase = createAdminClient();
  let query = supabase
    .from('search_queries')
    .select('id, query_text, district_id, district_name, geo_city, geo_state, geo_zip, channels, active, created_at')
    .order('district_id')
    .order('query_text');
  if (districtId) query = query.eq('district_id', districtId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
