import { createAdminClient } from '@/lib/supabase/admin';

const ARTICLE_COLUMNS = 'id, created_at, date, headline, summary, source, source_type, canary_score, tags, notes, is_earned_media, is_perched, link, district_id, innovation_reason, recommendation, source_query';
const ARTICLE_PAGE_SIZE = 1000;

export async function getArticles(districtId = null) {
  const supabase = createAdminClient();
  const allArticles = [];

  for (let from = 0; ; from += ARTICLE_PAGE_SIZE) {
    let query = supabase
      .from('news_stories')
      .select(ARTICLE_COLUMNS)
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

export async function getDistricts() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('districts')
    .select('id, name')
    .order('name');
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
