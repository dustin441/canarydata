import { safeSocialMediaUrl } from '@/lib/social.mjs';
import { detectSocialMediaType, readBoundedResponseBody, socialMediaReferer } from '@/lib/social-media-proxy.mjs';

export const runtime = 'nodejs';

const FORWARDED_HEADERS = ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
const DEFAULT_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8';

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
  const rawUrl = new URL(request.url).searchParams.get('url') || '';
  const targetUrl = safeSocialMediaUrl(rawUrl);
  if (!targetUrl || targetUrl.length > 5000) return Response.json({ error: 'Unsupported social media URL.' }, { status: 400 });

  let upstream;
  try {
    upstream = await fetchUpstream(targetUrl, request);
  } catch {
    return Response.json({ error: 'Social media could not be retrieved.' }, { status: 502 });
  }
  if (!upstream?.ok) {
    await upstream?.body?.cancel().catch(() => {});
    return Response.json({ error: 'Social media provider returned an unavailable response.' }, { status: 502 });
  }
  if (!safeSocialMediaUrl(upstream.url)) {
    await upstream.body?.cancel().catch(() => {});
    return Response.json({ error: 'Social media redirected to an unsupported host.' }, { status: 502 });
  }

  const upstreamType = (upstream.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  const supportedType = upstreamType.startsWith('image/') || upstreamType.startsWith('video/');
  let responseBody = upstream.body;
  let contentType = upstreamType;
  if (!supportedType) {
    let buffered;
    try {
      buffered = await readBoundedResponseBody(upstream);
    } catch (error) {
      const status = error?.message === 'social_media_too_large' ? 413 : 502;
      return Response.json({ error: status === 413 ? 'Social media exceeded the proxy size limit.' : 'Social media could not be read.' }, { status });
    }
    contentType = detectSocialMediaType(buffered);
    if (!contentType) return Response.json({ error: 'The upstream response was not supported media.' }, { status: 415 });
    responseBody = buffered;
  }

  const range = request.headers.get('range');
  const responseHeaders = new Headers({
    'Cache-Control': range ? 'private, max-age=300' : 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  });
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(responseBody, { status: upstream.status, headers: responseHeaders });
}
