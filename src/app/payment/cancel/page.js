import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'Payment Canceled | Canary Data',
};

export default function PaymentCancelPage() {
  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-logo">
          <Image src="/canary-logo.svg" alt="Canary Data" width={200} height={54} style={{ height: '44px', width: 'auto', marginBottom: '0.5rem' }} />
          <p>Media Intelligence Platform</p>
        </div>

        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '10px' }}>↩️</div>
          <h2>Payment not completed</h2>
          <p className="auth-subtitle">
            No payment was collected. You can return to checkout when you’re ready, or contact Canary if your district needs check/ACH handling instead.
          </p>
          <Link href="/payment" className="btn btn-primary" style={{ marginTop: '20px', width: '100%' }}>
            Try Checkout Again
          </Link>
        </div>
      </div>
    </div>
  );
}
