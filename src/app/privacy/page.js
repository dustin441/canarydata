import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy | Canary Data',
  description: 'Canary Data Privacy Policy — we never sell, share, or monetize your data.',
};

export default function PrivacyPolicy() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#0B0F19',
      color: '#e2e8f0',
      fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1.5rem 5%',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(11,15,25,0.95)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
          <svg width="32" height="27" viewBox="0 0 36 30" fill="none">
            <ellipse cx="14" cy="20" rx="11" ry="8" fill="#facc15"/>
            <circle cx="24" cy="13" r="6" fill="#facc15"/>
            <circle cx="26" cy="11.5" r="1.4" fill="#0B1120"/>
            <path d="M30 13 L36 11 L30 16Z" fill="#facc15"/>
            <path d="M3 20 L0 27 L7 23Z" fill="#facc15"/>
            <rect x="11" y="8" width="3" height="11" rx="1" fill="rgba(255,255,255,0.85)"/>
            <rect x="15.5" y="5" width="3" height="14" rx="1" fill="rgba(255,255,255,0.85)"/>
            <rect x="20" y="2" width="3" height="17" rx="1" fill="rgba(255,255,255,0.85)"/>
          </svg>
          <span style={{ color: '#facc15', fontWeight: 700, fontSize: '1.3rem' }}>Canary</span>
          <span style={{ color: '#fff', fontWeight: 400, fontSize: '1.3rem' }}>Data</span>
        </Link>
        <Link href="/" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '0.95rem' }}>
          ← Back to Home
        </Link>
      </header>

      {/* Content */}
      <main style={{ maxWidth: '760px', margin: '0 auto', padding: '5rem 5% 8rem' }}>

        {/* Top highlight box */}
        <div style={{
          background: 'rgba(16,185,129,0.08)',
          border: '1px solid rgba(16,185,129,0.3)',
          borderRadius: '16px',
          padding: '2rem 2.5rem',
          marginBottom: '3.5rem',
          boxShadow: '0 0 40px rgba(16,185,129,0.05)',
        }}>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#34d399', marginBottom: '0.75rem' }}>
            🔒 Our Core Commitment
          </p>
          <p style={{ color: '#e2e8f0', fontSize: '1.1rem', lineHeight: '1.7', margin: 0 }}>
            Canary Data will <strong>never sell, rent, share, or monetize your data or your district&apos;s data</strong> — period. The information you provide exists solely to power your intelligence dashboard. It is not a product. It is not shared with advertisers, data brokers, or any third party for commercial purposes.
          </p>
        </div>

        <h1 style={{ fontSize: '2.8rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-1px', marginBottom: '0.5rem' }}>
          Privacy Policy
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.95rem', marginBottom: '3.5rem' }}>
          Effective Date: April 10, 2026 &nbsp;·&nbsp; Last Updated: April 10, 2026
        </p>

        {sections.map((section) => (
          <section key={section.title} style={{ marginBottom: '3rem' }}>
            <h2 style={{
              fontSize: '1.4rem',
              fontWeight: 700,
              color: '#f8fafc',
              marginBottom: '1rem',
              paddingBottom: '0.75rem',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              {section.title}
            </h2>
            <div style={{ color: '#94a3b8', lineHeight: '1.8', fontSize: '1.05rem' }}>
              {section.content}
            </div>
          </section>
        ))}

        <div style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '12px',
          padding: '2rem 2.5rem',
          marginTop: '4rem',
        }}>
          <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: '1.7', margin: 0 }}>
            <strong style={{ color: '#94a3b8' }}>Questions about this policy?</strong> Contact us at{' '}
            <a href="mailto:privacy@canarydata.io" style={{ color: '#22d3ee', textDecoration: 'none' }}>
              privacy@canarydata.io
            </a>. We&apos;re a small team and will respond personally.
          </p>
        </div>
      </main>

      <footer style={{
        borderTop: '1px solid rgba(255,255,255,0.05)',
        padding: '3rem 5%',
        textAlign: 'center',
        color: '#64748b',
        fontSize: '0.9rem',
      }}>
        <p>© {new Date().getFullYear()} Canary Data. &nbsp;·&nbsp; <Link href="/" style={{ color: '#64748b', textDecoration: 'none' }}>Home</Link></p>
      </footer>
    </div>
  );
}

const sections = [
  {
    title: '1. Who We Are',
    content: (
      <p>
        Canary Data is a media intelligence platform serving public school districts and other public sector organizations. We collect and surface publicly available news and social media coverage to help communications teams stay informed and respond effectively. Our registered address and contact information are available upon request at{' '}
        <a href="mailto:privacy@canarydata.io" style={{ color: '#22d3ee', textDecoration: 'none' }}>privacy@canarydata.io</a>.
      </p>
    ),
  },
  {
    title: '2. Information We Collect',
    content: (
      <>
        <p style={{ marginBottom: '1rem' }}>We collect only what is necessary to provide our service:</p>
        <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
          <li style={{ marginBottom: '0.5rem' }}><strong style={{ color: '#e2e8f0' }}>Account information:</strong> Name, email address, and organizational affiliation provided during signup.</li>
          <li style={{ marginBottom: '0.5rem' }}><strong style={{ color: '#e2e8f0' }}>District configuration:</strong> Search terms, geographic parameters, and social accounts you designate for monitoring.</li>
          <li style={{ marginBottom: '0.5rem' }}><strong style={{ color: '#e2e8f0' }}>Usage data:</strong> Standard access logs (IP address, browser type, pages visited) for security and performance purposes only.</li>
          <li style={{ marginBottom: '0.5rem' }}><strong style={{ color: '#e2e8f0' }}>Publicly available content:</strong> News articles and social media posts retrieved from publicly accessible sources on your behalf.</li>
        </ul>
        <p>We do not collect sensitive personal information about students, staff, or community members. We do not use cookies for advertising or tracking purposes.</p>
      </>
    ),
  },
  {
    title: '3. How We Use Your Information',
    content: (
      <>
        <p style={{ marginBottom: '1rem' }}>Your information is used exclusively to:</p>
        <ul style={{ paddingLeft: '1.5rem' }}>
          <li style={{ marginBottom: '0.5rem' }}>Operate and deliver the Canary Data dashboard and monitoring service.</li>
          <li style={{ marginBottom: '0.5rem' }}>Authenticate your account and maintain session security.</li>
          <li style={{ marginBottom: '0.5rem' }}>Send service-related communications (account setup, invoices, feature updates).</li>
          <li style={{ marginBottom: '0.5rem' }}>Improve platform performance and fix technical issues.</li>
        </ul>
      </>
    ),
  },
  {
    title: '4. We Do Not Sell or Share Your Data',
    content: (
      <>
        <p style={{ marginBottom: '1rem', color: '#e2e8f0', fontWeight: 600 }}>
          This is non-negotiable. Canary Data does not and will never:
        </p>
        <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
          <li style={{ marginBottom: '0.5rem' }}>Sell your data or your district&apos;s data to any third party.</li>
          <li style={{ marginBottom: '0.5rem' }}>Share your data with advertisers, data brokers, or marketing partners.</li>
          <li style={{ marginBottom: '0.5rem' }}>Use your data to train AI models offered to other customers.</li>
          <li style={{ marginBottom: '0.5rem' }}>Aggregate or anonymize your data for resale.</li>
        </ul>
        <p>
          The only third parties that interact with your data are infrastructure providers (Supabase for database hosting, Vercel for application hosting, and Apify for public web scraping) who are bound by strict data processing agreements and handle your data solely to operate our service.
        </p>
      </>
    ),
  },
  {
    title: '5. Data Security',
    content: (
      <p>
        All data is stored in Supabase, a SOC 2 Type II compliant database platform, with row-level security policies enforcing strict data isolation between districts. Data is encrypted in transit (TLS 1.2+) and at rest. Access to production data is limited to authorized Canary Data personnel only.
      </p>
    ),
  },
  {
    title: '6. Data Retention',
    content: (
      <p>
        We retain your account and monitoring data for the duration of your subscription. Upon cancellation or written request, we will delete your account and associated district data within 30 days. Aggregated, non-identifiable usage logs may be retained for up to 12 months for security purposes.
      </p>
    ),
  },
  {
    title: '7. Your Rights',
    content: (
      <>
        <p style={{ marginBottom: '1rem' }}>You have the right to:</p>
        <ul style={{ paddingLeft: '1.5rem' }}>
          <li style={{ marginBottom: '0.5rem' }}>Request a copy of the data we hold about you or your organization.</li>
          <li style={{ marginBottom: '0.5rem' }}>Request correction of inaccurate information.</li>
          <li style={{ marginBottom: '0.5rem' }}>Request deletion of your account and associated data.</li>
          <li style={{ marginBottom: '0.5rem' }}>Opt out of any non-essential communications at any time.</li>
        </ul>
        <p style={{ marginTop: '1rem' }}>
          To exercise any of these rights, email us at{' '}
          <a href="mailto:privacy@canarydata.io" style={{ color: '#22d3ee', textDecoration: 'none' }}>privacy@canarydata.io</a>.
          We will respond within 10 business days.
        </p>
      </>
    ),
  },
  {
    title: '8. FERPA & Student Data',
    content: (
      <p>
        Canary Data does not collect, process, or store student educational records or personally identifiable student information as defined by FERPA. Our platform monitors publicly available media coverage of school districts — not internal school records, student information systems, or any data protected under FERPA or COPPA.
      </p>
    ),
  },
  {
    title: '9. Changes to This Policy',
    content: (
      <p>
        If we make material changes to this policy, we will notify subscribers by email at least 14 days before the change takes effect. Continued use of the service after that date constitutes acceptance of the updated policy. The current version will always be available at this URL.
      </p>
    ),
  },
];
