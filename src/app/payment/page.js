import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { startCanaryCheckout } from './actions';
import { getAuthenticatedBillingContext } from '@/lib/billing';

export const metadata = {
  title: 'Canary Data Payment | Annual Access',
  description: 'Secure Canary Data annual access payment through Stripe.',
};

export default async function PaymentPage() {
  const { user, districtId, districtName, email, onboardingRequest } = await getAuthenticatedBillingContext();
  if (!user) redirect('/login?redirect_to=/payment');

  const organizationName = districtName || onboardingRequest?.organization_name || '';
  const alreadyPaid = onboardingRequest?.payment_status === 'paid';

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-logo">
          <Image src="/canary-logo.svg" alt="Canary Data" width={200} height={54} style={{ height: '44px', width: 'auto', marginBottom: '0.5rem' }} />
          <p>Media Intelligence Platform</p>
        </div>

        <div className="auth-card">
          <h2>{alreadyPaid ? 'Payment already recorded' : 'Complete Canary Data payment'}</h2>
          <p className="auth-subtitle">
            You’re signed in, so Canary will apply this payment to the district/account tied to your login.
          </p>

          <div style={{
            marginBottom: '1rem', padding: '0.9rem 1rem', background: 'rgba(245,197,24,0.08)',
            border: '1px solid rgba(245,197,24,0.25)', borderRadius: '10px', color: 'var(--text-secondary)',
            fontSize: '0.86rem', lineHeight: '1.55',
          }}>
            <strong style={{ color: 'var(--text-primary)' }}>Account</strong><br />
            District: <span style={{ color: 'var(--text-primary)' }}>{organizationName || 'Not linked yet'}</span><br />
            Billing user: <span style={{ color: 'var(--text-primary)' }}>{email}</span><br />
            {districtId && <>District ID: <span style={{ color: 'var(--text-primary)' }}>{districtId}</span><br /></>}
            <br />
            <strong style={{ color: 'var(--text-primary)' }}>$1,499 annual access</strong><br />
            Add card details in Stripe Checkout, click pay, and Canary will bring you back to the confirmation page.
          </div>

          {!organizationName ? (
            <div className="auth-error">
              <span>⚠</span> This login is not tied to a district/account yet. Contact Canary before submitting payment.
            </div>
          ) : alreadyPaid ? (
            <Link href="/dashboard" className="btn btn-primary" style={{ width: '100%', textAlign: 'center' }}>
              Return to Dashboard
            </Link>
          ) : (
            <form action={startCanaryCheckout}>
              <button type="submit" className="btn btn-primary">
                Pay with Card
              </button>
            </form>
          )}
        </div>

        <div className="auth-footer">
          Questions about check/ACH? <a href="mailto:hello@canarydata.media">Contact Canary</a>
        </div>
      </div>
    </div>
  );
}
