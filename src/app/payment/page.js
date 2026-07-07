import Link from 'next/link';
import Image from 'next/image';
import { startCanaryCheckout } from './actions';

export const metadata = {
  title: 'Canary Data Payment | Annual Access',
  description: 'Secure Canary Data annual access payment through Stripe.',
};

const fieldStyle = { marginBottom: '1rem' };

export default async function PaymentPage({ searchParams }) {
  const params = await searchParams;
  const organizationName = params?.organization_name || params?.district || '';
  const contactEmail = params?.email || '';
  const requestId = params?.request_id || '';

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-logo">
          <Image src="/canary-logo.svg" alt="Canary Data" width={200} height={54} style={{ height: '44px', width: 'auto', marginBottom: '0.5rem' }} />
          <p>Media Intelligence Platform</p>
        </div>

        <div className="auth-card">
          <h2>Complete Canary Data payment</h2>
          <p className="auth-subtitle">
            Use this secure Stripe checkout after your trial/onboarding has been approved. If you still need setup review, use the onboarding link first.
          </p>

          <div style={{
            marginBottom: '1rem', padding: '0.9rem 1rem', background: 'rgba(245,197,24,0.08)',
            border: '1px solid rgba(245,197,24,0.25)', borderRadius: '10px', color: 'var(--text-secondary)',
            fontSize: '0.86rem', lineHeight: '1.55',
          }}>
            <strong style={{ color: 'var(--text-primary)' }}>$1,499 annual access</strong><br />
            Card payment is processed by Stripe. Canary can still handle check/ACH separately when needed.
          </div>

          <form action={startCanaryCheckout}>
            <input type="hidden" name="request_id" value={requestId} />

            <div className="form-group" style={fieldStyle}>
              <label htmlFor="organization_name">District / organization</label>
              <input id="organization_name" name="organization_name" className="form-input" defaultValue={organizationName} placeholder="Example City Schools" required />
            </div>

            <div className="form-group" style={fieldStyle}>
              <label htmlFor="contact_email">Billing email</label>
              <input id="contact_email" name="contact_email" type="email" className="form-input" defaultValue={contactEmail} placeholder="you@district.org" required />
            </div>

            <button type="submit" className="btn btn-primary">
              Continue to Secure Checkout
            </button>
          </form>
        </div>

        <div className="auth-footer">
          Not ready to pay? <Link href="/onboarding">Complete onboarding first</Link>
        </div>
      </div>
    </div>
  );
}
