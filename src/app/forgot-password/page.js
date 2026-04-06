'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-logo">
          <div className="auth-logo-icon">🐦</div>
          <h1>Canary</h1>
          <p>Media Intelligence Platform</p>
        </div>

        <div className="auth-card">
          <h2>Reset password</h2>
          <p className="auth-subtitle">
            Enter your email to receive a password reset link.
          </p>

          {error && (
            <div className="auth-error">
              <span>⚠</span> {error}
            </div>
          )}

          {success ? (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>✉️</div>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: '10px' }}>Check your email</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                We've sent a password reset link to <strong>{email}</strong>.
              </p>
              <button 
                onClick={() => router.push('/login')} 
                className="btn btn-secondary" 
                style={{ marginTop: '24px', width: '100%' }}
              >
                Back to Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
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

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? (
                  <span className="spinner" style={{ margin: '0 auto' }} />
                ) : (
                  'Send Reset Link'
                )}
              </button>
              
              <div style={{ textAlign: 'center', marginTop: '20px' }}>
                <Link 
                  href="/login" 
                  style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textDecoration: 'none' }}
                >
                  ← Back to Login
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
