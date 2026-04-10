'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-logo">
          <Image src="/canary-logo.svg" alt="Canary Data" width={200} height={54} style={{ height: '44px', width: 'auto', marginBottom: '0.5rem' }} />
          <p>Media Intelligence Platform</p>
        </div>

        <div className="auth-card">
          <h2>Sign in</h2>
          <p className="auth-subtitle">
            Monitor your media coverage and brand sentiment.
          </p>

          {error && (
            <div className="auth-error">
              <span>⚠</span> {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className="form-input"
                placeholder="you@organization.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <div style={{ textAlign: 'right', marginTop: '8px' }}>
                <Link 
                  href="/forgot-password" 
                  style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', textDecoration: 'none' }}
                  onMouseOver={(e) => e.target.style.color = 'var(--canary-yellow)'}
                  onMouseOut={(e) => e.target.style.color = 'var(--text-tertiary)'}
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? (
                <span className="spinner" style={{ margin: '0 auto' }} />
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <p
          style={{
            textAlign: 'center',
            marginTop: '24px',
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
          }}
        >
          Don&apos;t have an account?{' '}
          <Link href="/signup" style={{ color: 'var(--brand-primary)', textDecoration: 'none', fontWeight: '500' }}>
            Sign up
          </Link>
          <br />
          <br />
          <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
            Need enterprise access? <a href="mailto:dustin@eic.agency" style={{ color: 'inherit' }}>Contact your administrator</a>
          </span>
        </p>
      </div>
    </div>
  );
}
