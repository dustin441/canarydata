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

  const { error } = await supabase.from('feedback').insert({
    message: message.trim(),
    photo_url: photoUrl,
    district_id: districtId,
    district_name: districtName,
  });
  if (error) throw error;
}
