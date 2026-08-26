'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function ResetPassword() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [recoveryUserId, setRecoveryUserId] = useState('');

  useEffect(() => {
    let active = true;

    // createBrowserClient owns PKCE and legacy hash parsing. Only the
    // PASSWORD_RECOVERY event proves that a URL-created session may change a
    // password; an ordinary SIGNED_IN session must never unlock this page.
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || event !== 'PASSWORD_RECOVERY' || !session?.user?.id) return;
      setRecoveryUserId(session.user.id);
      setSessionReady(true);
      setError('');
      window.history.replaceState({}, document.title, window.location.pathname);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleVerifyCode(e) {
    e.preventDefault();
    setError('');

    if (!email.trim() || !/^\d{8}$/.test(recoveryCode.trim())) {
      setError('Enter your email address and the 8-digit recovery code.');
      return;
    }

    setLoading(true);
    const supabase = createClient({ auth: { detectSessionInUrl: false } });
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: recoveryCode.trim(),
      type: 'recovery',
    });

    if (verifyError || !data.session) {
      setError('That recovery code is invalid or expired. Request a new code and try again.');
      setLoading(false);
      return;
    }

    setRecoveryCode('');
    setRecoveryUserId(data.session.user.id);
    setSessionReady(true);
    setLoading(false);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!sessionReady || !recoveryUserId) {
      setError('Verify a recovery code before choosing a new password.');
      return;
    }

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
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user || user.id !== recoveryUserId) {
      setSessionReady(false);
      setRecoveryUserId('');
      setError('Your recovery session changed or expired. Request a new code and try again.');
      setLoading(false);
      return;
    }

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
          <h2>{sessionReady ? 'Update password' : 'Verify recovery code'}</h2>
          <p className="auth-subtitle">
            {sessionReady
              ? 'Enter your new password below to secure your account.'
              : 'Enter the email address and 8-digit code from your recovery email.'}
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
          ) : !sessionReady ? (
            <form onSubmit={handleVerifyCode}>
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

              <div className="form-group">
                <label htmlFor="recovery-code">Recovery Code</label>
                <input
                  id="recovery-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{8}"
                  maxLength={8}
                  className="form-input"
                  placeholder="12345678"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  required
                  autoComplete="one-time-code"
                />
              </div>

              <button className="btn btn-primary" disabled={loading}>
                {loading ? <span className="spinner" style={{ margin: '0 auto' }} /> : 'Verify Code'}
              </button>

              <button
                type="button"
                onClick={() => router.push('/forgot-password')}
                className="btn btn-secondary"
                style={{ width: '100%', marginTop: '12px' }}
              >
                Request New Code
              </button>
            </form>
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
                disabled={loading || !sessionReady}
              >
                {loading ? (
                  <span className="spinner" style={{ margin: '0 auto' }} />
                ) : (
                  'Update Password'
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
