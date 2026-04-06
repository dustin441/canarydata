'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function ResetPassword() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Basic check to ensure user is logged in
    async function checkAuth() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Your password reset session has expired. Please request a new link.');
      }
    }
    checkAuth();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.updateUser({
      password: password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
    
    // Redirect to dashboard after a short delay
    setTimeout(() => {
      router.push('/dashboard');
      router.refresh();
    }, 2000);
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
          <h2>Update password</h2>
          <p className="auth-subtitle">
            Enter your new password below to secure your account.
          </p>

          {error && (
            <div className="auth-error">
              <span>⚠</span> {error}
            </div>
          )}

          {success ? (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>✅</div>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: '10px' }}>Password updated!</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                Your password has been successfully reset. Redirecting you to the dashboard...
              </p>
              <div className="spinner" style={{ margin: '20px auto 0' }} />
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="password">New Password</label>
                <input
                  id="password"
                  type="password"
                  className="form-input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm New Password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  className="form-input"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !!error.includes('expired')}
              >
                {loading ? (
                  <span className="spinner" style={{ margin: '0 auto' }} />
                ) : (
                  'Update Password'
                )}
              </button>
              
              {error.includes('expired') && (
                <div style={{ textAlign: 'center', marginTop: '20px' }}>
                  <button 
                    onClick={() => router.push('/forgot-password')} 
                    className="btn btn-secondary" 
                    style={{ width: '100%' }}
                  >
                    Request New Link
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
