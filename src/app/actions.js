'use server';

import { createAdminClient } from '@/lib/supabase/admin';

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
