import { NextResponse } from 'next/server';
import { requireIntegrationActor } from '@/lib/integration-auth';
import { buildMetaAuthorizationUrl, createOauthState, metaConfigured, sanitizeReturnPath } from '@/lib/meta-integration.mjs';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    if (!metaConfigured() || process.env.META_INTEGRATION_ENABLED !== 'true') {
      return NextResponse.redirect(new URL('/dashboard/integrations?meta=not_configured', process.env.META_REDIRECT_URI || request.url), 303);
    }

    const requestOrigin = request.headers.get('origin');
    const allowedOrigin = new URL(process.env.META_REDIRECT_URI).origin;
    if (!requestOrigin || requestOrigin !== allowedOrigin) {
      const error = new Error('Invalid integration request origin.');
      error.status = 403;
      throw error;
    }

    const formData = await request.formData();
    const requestedDistrictId = String(formData.get('districtId') || '');
    const returnPath = sanitizeReturnPath(formData.get('returnPath'));
    const { actor, admin } = await requireIntegrationActor(requestedDistrictId);
    const { state, stateHash } = createOauthState();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await admin.from('social_provider_oauth_states').insert({
      state_hash: stateHash,
      provider: 'meta',
      user_id: actor.id,
      district_id: actor.districtId,
      return_path: returnPath,
      expires_at: expiresAt,
    });
    if (error) throw error;

    const response = NextResponse.redirect(buildMetaAuthorizationUrl(state), 303);
    response.cookies.set('canary_meta_oauth_binding', stateHash, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/integrations/meta/callback',
      maxAge: 600,
    });
    return response;
  } catch (error) {
    const destination = new URL('/dashboard/integrations', process.env.META_REDIRECT_URI || request.url);
    destination.searchParams.set('meta', error?.status === 403 ? 'forbidden' : 'start_failed');
    return NextResponse.redirect(destination, 303);
  }
}
