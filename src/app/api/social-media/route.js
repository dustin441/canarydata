import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeSocialMediaUrl, safeSocialUrl } from '@/lib/social.mjs';
import { detectSocialMediaType, readBoundedResponseBody, socialMediaReferer, unavailableSocialMediaResponse } from '@/lib/social-media-proxy.mjs';

export const runtime = 'nodejs';

const CACHE_BUCKET = 'social-media-cache';
const FORWARDED_HEADERS = ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
const DEFAULT_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8';

function cachePath(sourceUrl, targetUrl) {
  if (!sourceUrl || !targetUrl) return '';
  const media = new URL(targetUrl);
  const mediaIdentity = media.searchParams.get('ig_cache_key') || media.pathname;
  return `v1/${createHash('sha256').update(`${sourceUrl}|${mediaIdentity}`).digest('hex')}`;
}

function mediaHeaders(contentType, cacheState = 'miss') {
  return new Headers({
    'Cache-Control': 'public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800',
    'Content-Type': contentType,
    'X-Canary-Media-Cache': cacheState,
    'X-Content-Type-Options': 'nosniff',
  });
}

async function readCache(path) {
  if (!path) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(CACHE_BUCKET).download(path);
    if (error || !data) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    const declaredType = String(data.type || '').toLowerCase();
    const contentType = declaredType.startsWith('image/') || declaredType.startsWith('video/') ? declaredType : detectSocialMediaType(bytes);
    return contentType ? { bytes, contentType } : null;
  } catch {
    return null;
  }
}

async function writeCache(path, bytes, contentType) {
  if (!path || !contentType.startsWith('image/')) return false;
  try {
    const admin = createAdminClient();
    const { error } = await admin.storage.from(CACHE_BUCKET).upload(path, bytes, {
      cacheControl: '31536000',
      contentType,
      upsert: true,
    });
    return !error;
  } catch {
    return false;
  }
}

async function fetchUpstream(targetUrl, request) {
  const range = request.headers.get('range');
  const baseHeaders = {
    Accept: request.headers.get('accept') || DEFAULT_ACCEPT,
    'User-Agent': 'Mozilla/5.0 (compatible; CanaryDataMediaProxy/1.0)',
  };
  if (range) baseHeaders.Range = range;
  const referer = socialMediaReferer(targetUrl);
  const attempts = [baseHeaders, { ...baseHeaders, ...(referer ? { Referer: referer } : {}), 'Cache-Control': 'no-cache' }];
  let lastResponse = null;
  for (let index = 0; index < attempts.length; index += 1) {
    try {
      const response = await fetch(targetUrl, { headers: attempts[index], redirect: 'follow', cache: index ? 'no-store' : 'default', signal: AbortSignal.timeout(25000) });
      if (response.ok || index === attempts.length - 1 || ![408, 425, 429, 500, 502, 503, 504].includes(response.status)) return response;
      await response.body?.cancel().catch(() => {});
      lastResponse = response;
    } catch (error) {
      if (index === attempts.length - 1) throw error;
    }
  }
  return lastResponse;
}

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const rawUrl = requestUrl.searchParams.get('url') || '';
  const rawSource = requestUrl.searchParams.get('source') || '';
  const warm = requestUrl.searchParams.get('warm') === '1';
  const targetUrl = safeSocialMediaUrl(rawUrl);
  const sourceUrl = safeSocialUrl(rawSource);
  if (!targetUrl || targetUrl.length > 5000) return Response.json({ error: 'Unsupported social media URL.' }, { status: 400 });
  if (rawSource && (!sourceUrl || sourceUrl.length > 2000)) return Response.json({ error: 'Unsupported social source URL.' }, { status: 400 });

  const path = cachePath(sourceUrl, targetUrl);
  if (!request.headers.get('range') && path) {
    const cached = await readCache(path);
    if (cached) {
      if (warm) return Response.json({ cached: true, source: 'storage' }, { headers: { 'Cache-Control': 'no-store' } });
      return new Response(cached.bytes, { status: 200, headers: mediaHeaders(cached.contentType, 'hit') });
    }
  }

  let upstream;
  try {
    upstream = await fetchUpstream(targetUrl, request);
  } catch {
    return unavailableSocialMediaResponse(warm, 'fetch-failed');
  }
  if (!upstream?.ok) {
    await upstream?.body?.cancel().catch(() => {});
    return unavailableSocialMediaResponse(warm, `upstream-${upstream?.status || 'unavailable'}`);
  }
  if (!safeSocialMediaUrl(upstream.url)) {
    await upstream.body?.cancel().catch(() => {});
    return unavailableSocialMediaResponse(warm, 'unsupported-redirect');
  }

  const upstreamType = (upstream.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  const supportedType = upstreamType.startsWith('image/') || upstreamType.startsWith('video/');
  const shouldBuffer = !supportedType || (Boolean(path) && upstreamType.startsWith('image/'));
  let responseBody = upstream.body;
  let contentType = upstreamType;
  let cacheState = 'bypass';
  if (shouldBuffer) {
    let buffered;
    try {
      buffered = await readBoundedResponseBody(upstream);
    } catch (error) {
      if (error?.message === 'social_media_too_large') {
        return Response.json({ error: 'Social media exceeded the proxy size limit.' }, { status: 413 });
      }
      return unavailableSocialMediaResponse(warm, 'read-failed');
    }
    if (!supportedType) contentType = detectSocialMediaType(buffered);
    if (!contentType) return unavailableSocialMediaResponse(warm, 'unsupported-media-type');
    responseBody = buffered;
    if (contentType.startsWith('image/') && path) cacheState = await writeCache(path, buffered, contentType) ? 'stored' : 'store-failed';
  }

  if (warm) {
    if (!contentType.startsWith('image/')) return Response.json({ cached: false, source: 'unsupported-media-type' }, { status: 415 });
    return Response.json({ cached: cacheState === 'stored', source: cacheState }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const range = request.headers.get('range');
  const responseHeaders = mediaHeaders(contentType, cacheState);
  if (range) responseHeaders.set('Cache-Control', 'private, max-age=300');
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(responseBody, { status: upstream.status, headers: responseHeaders });
}
