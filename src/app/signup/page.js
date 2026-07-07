'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { submitLeadRequest } from '@/app/actions';

const fieldStyle = { marginBottom: '1rem' };

export default function Signup() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await submitLeadRequest(new FormData(e.currentTarget));
      setSuccess(true);
      e.currentTarget.reset();
    } catch (err) {
      setError(err?.message || 'Unable to submit your request. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-logo">
          <Image src="/canary-logo.svg" alt="Canary Data" width={200} height={54} style={{ height: '44px', width: 'auto', marginBottom: '0.5rem' }} />
          <p>Media Intelligence Platform</p>
        </div>

        <div className="auth-card">
          <h2>Request a Canary demo</h2>
          <p className="auth-subtitle">
            Share the basics and we’ll follow up with the right next step. No long setup form here — we’ll send the onboarding link only when it’s time to prepare your trial dashboard.
          </p>

          {error && (
            <div className="auth-error">
              <span>⚠</span> {error}
            </div>
          )}

          {success ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🐦</div>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: '10px' }}>Thanks — we have your info</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: '1.6' }}>
                We’ll follow up by email. If you’re a good fit for a trial, we’ll send the onboarding form that gathers and confirms the setup data Canary needs.
              </p>
              <Link href="/demo" className="btn btn-secondary" style={{ marginTop: '20px', width: '100%' }}>
                View Interactive Demo
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group" style={fieldStyle}>
                <label htmlFor="contact_name">Your name</label>
                <input id="contact_name" name="contact_name" className="form-input" placeholder="Jane Smith" required autoComplete="name" />
              </div>

              <div className="form-group" style={fieldStyle}>
                <label htmlFor="contact_email">Email</label>
                <input id="contact_email" name="contact_email" type="email" className="form-input" placeholder="you@district.org" required autoComplete="email" />
              </div>

              <div className="form-group" style={fieldStyle}>
                <label htmlFor="organization_name">District / organization</label>
                <input id="organization_name" name="organization_name" className="form-input" placeholder="Example City Schools" required autoComplete="organization" />
              </div>

              <div className="form-group" style={fieldStyle}>
                <label htmlFor="contact_title">Title / role</label>
                <input id="contact_title" name="contact_title" className="form-input" placeholder="Communications Director" autoComplete="organization-title" />
              </div>

              <div className="form-group" style={fieldStyle}>
                <label htmlFor="website">Website <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <input id="website" name="website" className="form-input" placeholder="examplek12.org" />
              </div>

              <div className="form-group" style={fieldStyle}>
                <label htmlFor="notes">What would you like to see?</label>
                <textarea id="notes" name="notes" className="form-input" rows={3} placeholder="Demo, trial, strategic alignment, social monitoring, accreditation reporting, etc." />
              </div>

              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <span className="spinner" style={{ margin: '0 auto' }} /> : 'Request Demo Follow-Up'}
              </button>

              <div style={{
                marginTop: '1rem', padding: '0.85rem 1rem', background: 'rgba(16,185,129,0.06)',
                border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', display: 'flex',
                alignItems: 'flex-start', gap: '0.5rem',
              }}>
                <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>💡</span>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  The full setup/onboarding form is separate so this page stays quick. Once approved for a trial, we’ll send a private onboarding link to confirm the data Canary needs for daily monitoring.
                </p>
              </div>
            </form>
          )}
        </div>

        <div className="auth-footer">
          Already have access? <Link href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
