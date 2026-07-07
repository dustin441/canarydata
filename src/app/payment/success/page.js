import Link from 'next/link';
import Image from 'next/image';
import { createAdminClient } from '@/lib/supabase/admin';
import { retrieveCheckoutSession } from '@/lib/stripe';

export const metadata = {
  title: 'Payment Confirmed | Canary Data',
};

async function markPaymentIfPossible(session) {
  if (session?.payment_status !== 'paid') return null;

  const requestId = session?.metadata?.canary_request_id;
  const contactEmail = session?.metadata?.contact_email || session?.customer_details?.email || session?.customer_email;
  const update = {
    payment_status: 'paid',
    stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
    access_status: 'pending_setup',
  };

  try {
    const supabase = createAdminClient();
    let targetId = requestId || null;
    if (!targetId && contactEmail) {
      const { data: latest } = await supabase
        .from('onboarding_requests')
        .select('id')
        .eq('contact_email', contactEmail.toLowerCase())
        .order('created_at', { ascending: false })
        .limit(1);
      targetId = latest?.[0]?.id || null;
    }
    if (!targetId) return null;

    const { data, error } = await supabase
      .from('onboarding_requests')
      .update(update)
      .eq('id', targetId)
      .select('id, organization_name, contact_email, payment_status');
    if (error) return null;
    return data?.[0] || null;
  } catch {
    return null;
  }
}

export default async function PaymentSuccessPage({ searchParams }) {
  const params = await searchParams;
  const sessionId = params?.session_id;
  let session = null;
  let verified = false;
  let savedRequest = null;
  let error = '';

  if (sessionId) {
    try {
      session = await retrieveCheckoutSession(sessionId);
      verified = session?.payment_status === 'paid';
      savedRequest = await markPaymentIfPossible(session);
    } catch (err) {
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
              ? 'Stripe confirmed the payment. Canary will finish the approved setup/backfill/login process.'
              : 'We could not confirm a paid Stripe session from this page yet.'}
          </p>

          {savedRequest && (
            <div style={{ marginTop: '1rem', padding: '0.9rem 1rem', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '10px', background: 'rgba(16,185,129,0.08)', color: 'var(--text-secondary)', fontSize: '0.86rem', lineHeight: '1.5', textAlign: 'left' }}>
              Internal onboarding record updated for <strong style={{ color: 'var(--text-primary)' }}>{savedRequest.organization_name}</strong>.
            </div>
          )}

          {error && <div className="auth-error" style={{ marginTop: '1rem' }}><span>⚠</span> {error}</div>}

          <Link href="/demo" className="btn btn-secondary" style={{ marginTop: '20px', width: '100%' }}>
            Return to Demo
          </Link>
        </div>
      </div>
    </div>
  );
}
