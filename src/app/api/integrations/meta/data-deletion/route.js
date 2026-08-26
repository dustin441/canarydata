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
    // The database distinguishes a recognized replay from a new stale request:
    // recognized hashes return their original receipt, while new stale hashes fail.
    const payload = verifyMetaSignedRequest(signedRequest, new Date(), { enforceFreshness: false });
    const providerUserId = String(payload.user_id);
    const confirmationCode = randomBytes(18).toString('base64url');
    const admin = createAdminClient();
    const { data: deletionRows, error: deletionError } = await admin.rpc('canary_complete_meta_data_deletion_v2', {
      p_provider_user_id: providerUserId,
      p_provider_user_id_hash: createHash('sha256').update(providerUserId).digest('hex'),
      p_confirmation_code: confirmationCode,
      p_signed_request_hash: payload.signed_request_hash,
      p_issued_at: new Date(Number(payload.issued_at) * 1000).toISOString(),
    });
    if (deletionError) throw deletionError;
    const receipt = Array.isArray(deletionRows) ? deletionRows[0] : null;
    if (!receipt?.confirmation_code) throw new Error('Meta deletion receipt was not persisted.');

    const statusUrl = new URL('/api/integrations/meta/data-deletion/status', process.env.META_REDIRECT_URI);
    statusUrl.searchParams.set('code', receipt.confirmation_code);
    return Response.json({ url: statusUrl.toString(), confirmation_code: receipt.confirmation_code });
  } catch (error) {
    console.error('Meta data deletion callback failed', { type: error?.name || 'Error' });
    return Response.json({ error: 'Meta data deletion could not be completed.' }, { status: 400 });
  }
}
