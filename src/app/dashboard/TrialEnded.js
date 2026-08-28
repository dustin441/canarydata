import Link from 'next/link';

export default function TrialEnded({ districtName = '', trialEndsAt = null, accessRevoked = false }) {
  const endedLabel = trialEndsAt
    ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(trialEndsAt))
    : null;
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', background: '#071426', color: '#f8fafc' }}>
      <section style={{ width: 'min(680px, 100%)', background: '#0f2138', border: '1px solid #274462', borderRadius: '24px', padding: 'clamp(1.5rem, 5vw, 3rem)', boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div style={{ color: '#60a5fa', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', fontSize: '.78rem' }}>Canary Data</div>
        <h1 style={{ margin: '.75rem 0 1rem', fontSize: 'clamp(2rem, 6vw, 3.25rem)', lineHeight: 1.05 }}>{accessRevoked ? 'Account access disabled' : 'Your trial has ended'}</h1>
        <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.7, fontSize: '1.05rem' }}>
          {accessRevoked
            ? 'This account has been disabled. Contact Canary Data for help. Payment cannot reactivate a disabled account.'
            : `${districtName ? `${districtName}'s` : 'Your district’s'} trial access is now inactive${endedLabel ? ` as of ${endedLabel}` : ''}. Your account and trial data are being retained while you decide how you would like to continue.`}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.9rem', marginTop: '2rem' }}>
          {!accessRevoked && (
            <Link href="/payment" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: '48px', padding: '.8rem 1.15rem', borderRadius: '12px', background: '#fbbf24', color: '#172033', fontWeight: 800, textDecoration: 'none' }}>
              Continue Your Access
            </Link>
          )}
          <a href="mailto:hello@canarydata.media?subject=Canary%20Data%20trial%20follow-up" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: '48px', padding: '.8rem 1.15rem', borderRadius: '12px', border: '1px solid #4b6683', color: '#f8fafc', fontWeight: 700, textDecoration: 'none' }}>
            Talk With Us
          </a>
        </div>
        <p style={{ margin: '1.5rem 0 0', color: '#94a3b8', lineHeight: 1.6, fontSize: '.92rem' }}>
          {accessRevoked
            ? 'Email Canary Data so an authorized operator can review the account status.'
            : 'Need a price quote or purchase-order support? Continue to the billing path or email us and we will help with the next step.'}
        </p>
      </section>
    </main>
  );
}
