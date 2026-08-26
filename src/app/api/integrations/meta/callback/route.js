import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireIntegrationActor } from '@/lib/integration-auth';
import {
  META_REQUIRED_SCOPES,
  constantTimeEqualText,
  debugMetaToken,
  encryptMetaToken,
  exchangeMetaCode,
  hashOauthState,
  metaGrantedScopes,
  metaEpochExpiry,
  metaGraph,
  metaGraphAll,
  metaIntegrationEnabledForDistrict,
  sanitizeReturnPath,
  tokenExpiry,
} from '@/lib/meta-integration.mjs';

export const runtime = 'nodejs';

function redirectWithStatus(request, path, status, detail = null) {
  const destination = new URL(sanitizeReturnPath(path), process.env.META_REDIRECT_URI || request.url);
  destination.searchParams.set('meta', status);
  if (detail) destination.searchParams.set('detail', detail);
  const response = NextResponse.redirect(destination);
  response.cookies.set('canary_meta_oauth_binding', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/integrations/meta/callback',
    maxAge: 0,
  });
  return response;
}

function assetRows({ pages }) {
  const rows = [];
  for (const page of pages) {
    rows.push({
      provider_asset_id: String(page.id),
      asset_type: 'facebook_page',
      platform: 'facebook',
      name: String(page.name || 'Facebook Page'),
      handle: null,
      profile_url: `https://www.facebook.com/${encodeURIComponent(String(page.id))}`,
      parent_provider_asset_id: null,
      metadata: { category: page.category || null, tasks: Array.isArray(page.tasks) ? page.tasks : [] },
    });
    const instagram = page.instagram_business_account;
    if (instagram?.id) {
      rows.push({
        provider_asset_id: String(instagram.id),
        asset_type: 'instagram_account',
        platform: 'instagram',
        name: String(instagram.name || instagram.username || `${page.name || 'Facebook Page'} Instagram`),
        handle: instagram.username ? String(instagram.username) : null,
        profile_url: instagram.username ? `https://www.instagram.com/${encodeURIComponent(String(instagram.username))}/` : null,
        parent_provider_asset_id: String(page.id),
        metadata: { facebook_page_id: String(page.id), profile_picture_url: instagram.profile_picture_url || null },
      });
    }
  }
  return rows;
}

export async function GET(request) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const providerError = url.searchParams.get('error');
  const admin = createAdminClient();
  let returnPath = '/dashboard/integrations';
  let stage = 'state_validation';
  let accessToken = null;
  let preparedDistrictId = null;
  let preparedAttemptId = null;
  let finalized = false;

  try {
    if (!state) return redirectWithStatus(request, returnPath, 'invalid_state');
    const stateHash = hashOauthState(state);
    const cookieStore = await cookies();
    const bindingHash = cookieStore.get('canary_meta_oauth_binding')?.value || '';
    if (!constantTimeEqualText(stateHash, bindingHash)) {
      return redirectWithStatus(request, returnPath, 'invalid_state');
    }
    const { data: oauthState, error: stateError } = await admin
      .from('social_provider_oauth_states')
      .select('state_hash,user_id,district_id,return_path,expires_at,consumed_at')
      .eq('state_hash', stateHash)
      .maybeSingle();
    if (stateError) throw stateError;
    if (!oauthState || oauthState.consumed_at || new Date(oauthState.expires_at).getTime() <= Date.now()) {
      return redirectWithStatus(request, returnPath, 'invalid_state');
    }
    returnPath = sanitizeReturnPath(oauthState.return_path);

    const { actor } = await requireIntegrationActor(oauthState.district_id);
    if (actor.id !== oauthState.user_id || actor.districtId !== oauthState.district_id) {
      return redirectWithStatus(request, returnPath, 'forbidden');
    }

    const { data: consumedRows, error: consumeError } = await admin.rpc('canary_consume_meta_oauth_state', {
      p_state_hash: stateHash,
      p_user_id: actor.id,
      p_district_id: actor.districtId,
    });
    if (consumeError) throw consumeError;
    if (!Array.isArray(consumedRows) || consumedRows.length !== 1) {
      return redirectWithStatus(request, returnPath, 'invalid_state');
    }
    returnPath = sanitizeReturnPath(consumedRows[0].return_path || returnPath);
    if (providerError || !code) return redirectWithStatus(request, returnPath, 'cancelled');
    if (!metaIntegrationEnabledForDistrict(actor.districtId)) {
      return redirectWithStatus(request, returnPath, 'not_configured');
    }

    stage = 'code_exchange';
    const tokenGrant = await exchangeMetaCode(code);
    accessToken = tokenGrant.access_token;

    stage = 'token_introspection';
    const tokenData = await debugMetaToken(accessToken);
    if (tokenData?.is_valid !== true
      || String(tokenData?.app_id || '') !== String(process.env.META_APP_ID)
      || !tokenData?.user_id) {
      throw new Error('Meta grant validation failed.');
    }

    const granted = metaGrantedScopes(tokenData);
    const declined = META_REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));
    const pageFields = granted.includes('instagram_basic')
      ? 'id,name,category,tasks,instagram_business_account{id,username,name,profile_picture_url}'
      : 'id,name,category,tasks';
    stage = 'asset_discovery';
    const pages = granted.includes('pages_show_list')
      ? await metaGraphAll('me/accounts', accessToken, { fields: pageFields, limit: '100' })
      : [];

    const providerUserId = String(tokenData.user_id);
    const providerUserIdHash = createHash('sha256').update(providerUserId).digest('hex');
    const providerUserName = null;
    stage = 'connection_prepare';
    const { data: connectionId, error: prepareError } = await admin.rpc('canary_prepare_meta_connection_v2', {
      p_attempt_id: consumedRows[0].oauth_attempt_id,
      p_district_id: actor.districtId,
      p_connected_by: actor.id,
      p_provider_app_id: process.env.META_APP_ID,
      p_provider_user_id: providerUserId,
      p_provider_user_id_hash: providerUserIdHash,
      p_provider_user_name: providerUserName,
      p_expected_connection_id: consumedRows[0].expected_connection_id,
      p_expected_lifecycle_version: consumedRows[0].expected_lifecycle_version,
    });
    if (prepareError) throw prepareError;
    if (!connectionId) throw new Error('Canary could not prepare the Meta connection.');
    preparedDistrictId = actor.districtId;
    preparedAttemptId = consumedRows[0].oauth_attempt_id;

    const tokenContext = `${connectionId}:${actor.districtId}:meta`;
    const rows = assetRows({ pages });
    stage = 'connection_finalize';
    const { error: finalizeError } = await admin.rpc('canary_finalize_meta_connection_v2', {
      p_attempt_id: preparedAttemptId,
      p_connection_id: connectionId,
      p_district_id: actor.districtId,
      p_connected_by: actor.id,
      p_provider_app_id: process.env.META_APP_ID,
      p_provider_user_id: providerUserId,
      p_provider_user_id_hash: providerUserIdHash,
      p_provider_user_name: providerUserName,
      p_status: declined.length ? 'needs_permissions' : 'active',
      p_token_expires_at: tokenExpiry(tokenGrant.expires_in)
        || metaEpochExpiry(tokenData?.expires_at),
      p_data_access_expires_at: metaEpochExpiry(tokenData?.data_access_expires_at),
      p_granted_scopes: granted,
      p_declined_scopes: declined,
      p_encrypted_access_token: encryptMetaToken(accessToken, tokenContext),
      p_key_version: 1,
      p_assets: rows,
    });
    if (finalizeError) throw finalizeError;
    finalized = true;

    return redirectWithStatus(request, returnPath, declined.length ? 'permissions_limited' : 'connected');
  } catch (error) {
    // Meta permission deletion is app/user-wide. A failed reconnect must not
    // revoke a healthy or concurrently successful grant, so discard the
    // in-memory token and abandon only this locally claimed attempt.
    accessToken = null;
    if (preparedAttemptId && preparedDistrictId && !finalized) {
      const { error: cleanupError } = await admin.rpc('canary_abandon_meta_connection_attempt', {
        p_attempt_id: preparedAttemptId,
        p_district_id: preparedDistrictId,
      });
      if (cleanupError) console.warn('Meta pending connection cleanup failed', { code: cleanupError.code || 'unknown' });
    }
    console.error('Meta OAuth callback failed', { stage, code: error?.code || 'unknown', type: error?.type || error?.name || 'Error' });
    const identityMismatch = String(error?.message || '').includes('different Meta identity');
    return redirectWithStatus(request, returnPath, identityMismatch ? 'identity_mismatch' : 'callback_failed');
  }
}
