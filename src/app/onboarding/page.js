'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { discoverOnboardingProfile, submitOnboardingRequest } from '@/app/actions';

const fieldStyle = { marginBottom: '1rem' };
const DRAFT_FIELDS = [
  ['mission_vision_values', 'Mission / vision / values'],
  ['strategic_priorities', 'Strategic priorities / focus areas'],
  ['social_handles', 'Official social handles'],
  ['keywords', 'Keywords, nicknames, mascots, or terms to monitor'],
  ['school_names', 'School names'],
  ['known_exclusions', 'Known lookalikes or exclusions'],
  ['discovery_notes', 'Notes for Canary review'],
];

function formDataToObject(formData) {
  return Object.fromEntries(formData.entries());
}

function appendObjectToFormData(formData, values) {
  Object.entries(values).forEach(([key, value]) => formData.append(key, value ?? ''));
}

export default function Onboarding() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [step, setStep] = useState('intake');
  const [intake, setIntake] = useState({});
  const [draft, setDraft] = useState({});
  const [discovery, setDiscovery] = useState(null);

  async function handleDiscover(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const formData = new FormData(e.currentTarget);
      const values = formDataToObject(formData);
      const result = await discoverOnboardingProfile(formData);
      setIntake(values);
      setDraft(result.confirmed_profile || {});
      setDiscovery(result.discovered_profile || null);
      setStep('confirm');
    } catch (err) {
      setError(err?.message || 'Unable to prepare setup draft. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const formData = new FormData();
      appendObjectToFormData(formData, intake);
      formData.append('confirmed_profile', JSON.stringify(draft));
      await submitOnboardingRequest(formData);
      setSuccess(true);
      setStep('success');
    } catch (err) {
      setError(err?.message || 'Unable to submit confirmed trial request. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="auth-page">
      <div className="auth-container" style={{ maxWidth: '820px' }}>
        <div className="auth-logo">
          <Image src="/canary-logo.svg" alt="Canary Data" width={200} height={54} style={{ height: '44px', width: 'auto', marginBottom: '0.5rem' }} />
          <p>Media Intelligence Platform</p>
        </div>

        <div className="auth-card" style={{ maxWidth: '820px' }}>
          <h2>{step === 'confirm' ? 'Confirm your trial setup' : 'Request a 30-day district trial'}</h2>
          <p className="auth-subtitle">
            {step === 'confirm'
              ? 'Review what Canary found and edit anything before sending it to our setup team.'
              : 'Share the basics and Canary will prepare a clean test dashboard before we create your login. No payment is due upfront.'}
          </p>

          {error && (
            <div className="auth-error">
              <span>⚠</span> {error}
            </div>
          )}

          {success ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🐦</div>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: '10px' }}>Confirmed setup received</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: '1.6' }}>
                We’ll review your confirmed setup, tune exclusions/lookalikes, run the clean-results test/backfill, and create your login once the dashboard is ready for first impressions.
              </p>
              <div style={{
                marginTop: '1rem', padding: '1rem', border: '1px solid rgba(245,197,24,0.25)',
                background: 'rgba(245,197,24,0.08)', borderRadius: '12px', color: 'var(--text-secondary)',
                fontSize: '0.86rem', lineHeight: '1.6', textAlign: 'left',
              }}>
                <strong style={{ color: 'var(--text-primary)' }}>What happens next:</strong>
                <ol style={{ margin: '0.65rem 0 0 1.15rem', padding: 0 }}>
                  <li>Canary reviews your confirmed strategic language, handles, keywords, and exclusions.</li>
                  <li>We run the setup/backfill and manually QA the first results.</li>
                  <li>We create your login when the dashboard is clean.</li>
                  <li>Your 30-day trial starts when access is granted.</li>
                </ol>
              </div>
              <Link href="/demo" className="btn btn-secondary" style={{ marginTop: '20px', width: '100%' }}>
                View Interactive Demo
              </Link>
            </div>
          ) : step === 'confirm' ? (
            <form onSubmit={handleApprove}>
              <div style={{
                marginBottom: '1rem', padding: '0.85rem 1rem', background: 'rgba(59,130,246,0.08)',
                border: '1px solid rgba(59,130,246,0.2)', borderRadius: '10px', color: 'var(--text-secondary)',
                fontSize: '0.84rem', lineHeight: '1.55',
              }}>
                {discovery?.website_fetched
                  ? 'Canary drafted this from your website and submitted details. Please approve or edit before it goes to our review queue.'
                  : `Canary could not fully read the website automatically${discovery?.fetch_error ? ` (${discovery.fetch_error})` : ''}. Please add/edit what you can before sending it to our review queue.`}
              </div>

              {DRAFT_FIELDS.map(([key, label]) => (
                <div className="form-group" style={fieldStyle} key={key}>
                  <label htmlFor={key}>{label}</label>
                  <textarea
                    id={key}
                    className="form-input"
                    rows={key.includes('mission') || key.includes('strategic') ? 5 : 3}
                    value={draft[key] || ''}
                    onChange={(e) => updateDraft(key, e.target.value)}
                    placeholder={key.includes('mission') ? 'Paste or edit mission, vision, values, beliefs...' : undefined}
                  />
                </div>
              ))}

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => setStep('intake')} style={{ flex: '1 1 180px' }}>
                  Back to Intake
                </button>
                <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: '2 1 260px' }}>
                  {loading ? <span className="spinner" style={{ margin: '0 auto' }} /> : 'Approve Setup for Canary Review'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleDiscover}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.85rem' }}>
                <div className="form-group" style={fieldStyle}>
                  <label htmlFor="organization_name">District / organization name</label>
                  <input id="organization_name" name="organization_name" className="form-input" defaultValue={intake.organization_name || ''} placeholder="Example City Schools" required />
                </div>

                <div className="form-group" style={fieldStyle}>
                  <label htmlFor="website">Website</label>
                  <input id="website" name="website" className="form-input" defaultValue={intake.website || ''} placeholder="examplek12.org" required />
                </div>

                <div className="form-group" style={fieldStyle}>
                  <label htmlFor="contact_name">Your name</label>
                  <input id="contact_name" name="contact_name" className="form-input" defaultValue={intake.contact_name || ''} placeholder="Jane Smith" required autoComplete="name" />
                </div>

                <div className="form-group" style={fieldStyle}>
                  <label htmlFor="contact_email">Email</label>
                  <input id="contact_email" name="contact_email" type="email" className="form-input" defaultValue={intake.contact_email || ''} placeholder="you@district.org" required autoComplete="email" />
                </div>

                <div className="form-group" style={fieldStyle}>
                  <label htmlFor="contact_title">Title / role</label>
                  <input id="contact_title" name="contact_title" className="form-input" defaultValue={intake.contact_title || ''} placeholder="Communications Director" autoComplete="organization-title" />
                </div>

                <div className="form-group" style={fieldStyle}>
                  <label htmlFor="city">City</label>
                  <input id="city" name="city" className="form-input" defaultValue={intake.city || ''} placeholder="Example" />
                </div>

                <div className="form-group" style={fieldStyle}>
                  <label htmlFor="state">State</label>
                  <input id="state" name="state" className="form-input" defaultValue={intake.state || ''} placeholder="AL" maxLength={32} />
                </div>

                <div className="form-group" style={fieldStyle}>
                  <label htmlFor="zip">ZIP</label>
                  <input id="zip" name="zip" className="form-input" defaultValue={intake.zip || ''} placeholder="35000" inputMode="numeric" />
                </div>
              </div>

              <div className="form-group" style={fieldStyle}>
                <label htmlFor="social_handles">Official social handles or URLs</label>
                <textarea id="social_handles" name="social_handles" className="form-input" rows={3} defaultValue={intake.social_handles || ''} placeholder="Facebook, Instagram, X/Twitter, TikTok, YouTube, LinkedIn..." />
              </div>

              <div className="form-group" style={fieldStyle}>
                <label htmlFor="keywords">Keywords, nicknames, mascots, or terms Canary should monitor</label>
                <textarea id="keywords" name="keywords" className="form-input" rows={3} defaultValue={intake.keywords || ''} placeholder="District name variants, superintendent name, mascot, abbreviations, common hashtags..." />
              </div>

              <div className="form-group" style={fieldStyle}>
                <label htmlFor="school_names">School names</label>
                <textarea id="school_names" name="school_names" className="form-input" rows={3} defaultValue={intake.school_names || ''} placeholder="Paste known schools, campuses, academies, programs, or feeder patterns." />
              </div>

              <div className="form-group" style={fieldStyle}>
                <label htmlFor="known_exclusions">Known lookalikes or exclusions</label>
                <textarea id="known_exclusions" name="known_exclusions" className="form-input" rows={2} defaultValue={intake.known_exclusions || ''} placeholder="Same-name cities in other states, unrelated schools, old accounts, local businesses with similar names..." />
              </div>

              <div className="form-group" style={fieldStyle}>
                <label htmlFor="current_monitoring">Current monitoring platform, if any</label>
                <input id="current_monitoring" name="current_monitoring" className="form-input" defaultValue={intake.current_monitoring || ''} placeholder="Metro Monitor, Meltwater, Google Alerts, none, etc." />
              </div>

              <div className="form-group" style={fieldStyle}>
                <label htmlFor="notes">Anything else we should know?</label>
                <textarea id="notes" name="notes" className="form-input" rows={3} defaultValue={intake.notes || ''} placeholder="Priority topics, board reporting needs, accreditation artifacts, crisis concerns, launch timing..." />
              </div>

              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <span className="spinner" style={{ margin: '0 auto' }} /> : 'Find and Confirm Setup Details'}
              </button>

              <div style={{
                marginTop: '1rem', padding: '0.85rem 1rem', background: 'rgba(16,185,129,0.06)',
                border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', display: 'flex',
                alignItems: 'flex-start', gap: '0.5rem',
              }}>
                <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>🔒</span>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  We use this information to draft your setup and reduce irrelevant results. Your login is created only after you confirm the setup and Canary manually reviews the first results.{' '}
                  <Link href="/privacy" style={{ color: '#34d399', textDecoration: 'none', fontWeight: 600 }}>
                    Privacy Policy
                  </Link>
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
