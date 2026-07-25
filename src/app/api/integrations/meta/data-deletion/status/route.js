import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function GET(request) {
  const code = new URL(request.url).searchParams.get('code') || '';
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(code)) return Response.json({ status: 'not_found' }, { status: 404 });
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('social_provider_deletion_requests')
    .select('status,requested_at,completed_at,detail')
    .eq('confirmation_code', code)
    .maybeSingle();
  if (error || !data) return Response.json({ status: 'not_found' }, { status: 404 });
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
