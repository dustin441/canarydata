import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { retrieveCheckoutSession } from '@/lib/stripe';
import { getAuthenticatedBillingContext } from '@/lib/billing';
import { markCanaryPaymentPaid } from '@/lib/payment-state';

export const metadata = {
  title: 'Payment Confirmed | Canary Data',
};

export default async function PaymentSuccessPage({ searchParams }) {
  const billingContext = await getAuthenticatedBillingContext();
  if (!billingContext.user) redirect('/login?redirect_to=/payment/success');

  const params = await searchParams;
  const sessionId = params?.session_id;
  let session = null;
  let verified = false;
  let savedRequest = null;
  let error = '';

  if (sessionId) {
    try {
      session = await retrieveCheckoutSession(sessionId);
      const sessionUserId = session?.metadata?.user_id;
      const protectedDistrictId = String(billingContext.user.app_metadata?.district_id || '');
      if (!sessionUserId || sessionUserId !== billingContext.user.id) {
        error = 'This Stripe session does not match the signed-in user.';
      } else if (!protectedDistrictId || session?.metadata?.district_id !== protectedDistrictId) {
        error = 'This Stripe session does not match the signed-in district.';
      } else if (session?.payment_status !== 'paid') {
        error = 'Stripe has not confirmed payment for this session yet.';
      } else {
        const paymentResult = await markCanaryPaymentPaid({ session });
        verified = paymentResult.ok === true;
        savedRequest = paymentResult.ok
          ? { organization_name: billingContext.districtName || session?.metadata?.organization_name || 'your account' }
          : null;
      }
    } catch (err) {
      verified = false;
      savedRequest = null;
      error = err?.message || 'Unable to verify payment yet.';
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-logo">
          <Image src="/canary-logo.svg" alt="Canary Data" width={200} height={54} style={{ height: '44px', width: 'auto', marginBottom: '0.5rem' }} />
          <p>Media Intelligence Platform</p>
        </div>

        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '10px' }}>{verified ? '✅' : '⏳'}</div>
          <h2>{verified ? 'Payment confirmed' : 'Payment verification pending'}</h2>
          <p className="auth-subtitle">
            {verified
              ? 'Stripe confirmed the payment for the account tied to your login. Thank you.'
              : 'We could not confirm a paid Stripe session for this signed-in account yet.'}
          </p>

          {savedRequest && (
            <div style={{ marginTop: '1rem', padding: '0.9rem 1rem', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '10px', background: 'rgba(16,185,129,0.08)', color: 'var(--text-secondary)', fontSize: '0.86rem', lineHeight: '1.5', textAlign: 'left' }}>
              Payment record updated for <strong style={{ color: 'var(--text-primary)' }}>{savedRequest.organization_name}</strong>.
            </div>
          )}

          {error && <div className="auth-error" style={{ marginTop: '1rem' }}><span>⚠</span> {error}</div>}

          <Link href="/dashboard" className="btn btn-secondary" style={{ marginTop: '20px', width: '100%' }}>
            Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
