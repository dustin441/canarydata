import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

function safeNextPath(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const nextPath = safeNextPath(requestUrl.searchParams.get('next'));
  const response = NextResponse.redirect(new URL(nextPath, requestUrl.origin));

  if (!code) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const retryUrl = new URL('/forgot-password', requestUrl.origin);
    retryUrl.searchParams.set('error', 'invalid_or_expired_link');
    return NextResponse.redirect(retryUrl);
  }

  return response;
}
