'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';

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
