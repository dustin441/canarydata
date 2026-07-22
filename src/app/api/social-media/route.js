import { safeSocialMediaUrl } from '@/lib/social.mjs';

export const runtime = 'nodejs';

const FORWARDED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

export async function GET(request) {
  const rawUrl = new URL(request.url).searchParams.get('url') || '';
  const targetUrl = safeSocialMediaUrl(rawUrl);

  if (!targetUrl || targetUrl.length > 5000) {
    return Response.json({ error: 'Unsupported social media URL.' }, { status: 400 });
  }

  const upstreamHeaders = {
    Accept: request.headers.get('accept') || 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (compatible; CanaryDataMediaProxy/1.0)',
  };
  const range = request.headers.get('range');
  if (range) upstreamHeaders.Range = range;

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      headers: upstreamHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    return Response.json({ error: 'Social media could not be retrieved.' }, { status: 502 });
  }

  if (!safeSocialMediaUrl(upstream.url)) {
    return Response.json({ error: 'Social media redirected to an unsupported host.' }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
    return Response.json({ error: 'The upstream response was not supported media.' }, { status: 415 });
  }

  const responseHeaders = new Headers({
    'Cache-Control': range ? 'private, max-age=300' : 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
