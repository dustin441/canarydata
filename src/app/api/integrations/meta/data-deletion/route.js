import { createHash, randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { metaDeletionConfigured, verifyMetaSignedRequest } from '@/lib/meta-integration.mjs';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json({
    ok: true,
    endpoint: 'Meta data deletion callback',
    method: 'POST',
  });
}

export async function POST(request) {
  try {
    if (!metaDeletionConfigured()) return Response.json({ error: 'Meta data deletion is not configured.' }, { status: 503 });
    const contentType = request.headers.get('content-type') || '';
    let signedRequest = '';
    if (contentType.includes('application/json')) {
      const body = await request.json();
      signedRequest = body?.signed_request || '';
    } else {
      const body = await request.formData();
      signedRequest = body.get('signed_request') || '';
    }
    const payload = verifyMetaSignedRequest(signedRequest);
    const providerUserId = String(payload.user_id);
    const confirmationCode = randomBytes(18).toString('base64url');
    const admin = createAdminClient();
    const { error: deletionError } = await admin.rpc('canary_complete_meta_data_deletion', {
      p_provider_user_id: providerUserId,
      p_provider_user_id_hash: createHash('sha256').update(providerUserId).digest('hex'),
      p_confirmation_code: confirmationCode,
    });
    if (deletionError) throw deletionError;

    const statusUrl = new URL('/api/integrations/meta/data-deletion/status', process.env.META_REDIRECT_URI);
    statusUrl.searchParams.set('code', confirmationCode);
    return Response.json({ url: statusUrl.toString(), confirmation_code: confirmationCode });
  } catch (error) {
    console.error('Meta data deletion callback failed', { type: error?.name || 'Error' });
    return Response.json({ error: 'Meta data deletion could not be completed.' }, { status: 400 });
  }
}
