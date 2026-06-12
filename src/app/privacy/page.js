import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'Privacy Policy | Canary Data',
  description: 'Canary Data Privacy Policy — public-data monitoring, district-controlled configuration, and protection of customer and derivative analysis data.',
};

const linkStyle = { color: '#22d3ee', textDecoration: 'none' };
const listStyle = { paddingLeft: '1.5rem', marginBottom: '1rem' };
const itemStyle = { marginBottom: '0.5rem' };
const strongStyle = { color: '#e2e8f0' };

export default function PrivacyPolicy() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#0B0F19',
      color: '#e2e8f0',
      fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
    }}>
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
        <Link href="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
          <Image src="/canary-logo.svg" alt="Canary Data" width={160} height={43} style={{ height: '32px', width: 'auto' }} />
        </Link>
        <Link href="/" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '0.95rem' }}>
          ← Back to Home
        </Link>
      </header>

      <main style={{ maxWidth: '820px', margin: '0 auto', padding: '5rem 5% 8rem' }}>
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
            Canary Data monitors publicly accessible media and social content for district communications teams. We will <strong>never sell, rent, share, or monetize customer data, district configuration, or the analysis generated for a customer</strong>. Customer information exists solely to operate the platform, protect accounts, and deliver the subscribed service.
          </p>
        </div>

        <h1 style={{ fontSize: '2.8rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-1px', marginBottom: '0.5rem' }}>
          Privacy Policy
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.95rem', marginBottom: '3.5rem' }}>
          Effective Date: June 5, 2026 &nbsp;·&nbsp; Last Updated: June 9, 2026
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
            <a href="mailto:privacy@canarydata.media" style={linkStyle}>
              privacy@canarydata.media
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
        Canary Data is a media intelligence platform that helps public school districts and other public sector organizations monitor publicly accessible news coverage, online conversations, and social media mentions related to their organization, schools, programs, and publicly identifiable leadership. The platform is designed to help communications teams understand public discussion, identify emerging issues, track sentiment, evaluate communications impact, and make informed messaging decisions. Contact us at{' '}
        <a href="mailto:privacy@canarydata.media" style={linkStyle}>privacy@canarydata.media</a>.
      </p>
    ),
  },
  {
    title: '2. Information We Collect',
    content: (
      <>
        <p style={{ marginBottom: '1rem' }}>We collect only what is necessary to provide and secure the service:</p>
        <ul style={listStyle}>
          <li style={itemStyle}><strong style={strongStyle}>Account information:</strong> name, email address, organization, role, and other information provided during signup or account support.</li>
          <li style={itemStyle}><strong style={strongStyle}>District configuration:</strong> district names, schools, geographic parameters, search terms, monitored public sources, and public social accounts or hashtags designated for monitoring.</li>
          <li style={itemStyle}><strong style={strongStyle}>Publicly accessible content:</strong> news articles, public websites, public posts, metadata, and links retrieved from publicly available sources on a customer&apos;s behalf.</li>
          <li style={itemStyle}><strong style={strongStyle}>Platform outputs:</strong> summaries, sentiment scores, risk levels, recommendations, tags, reports, exports, and other derivative analysis generated for the customer.</li>
          <li style={itemStyle}><strong style={strongStyle}>Usage and security data:</strong> access logs, IP address, browser type, pages visited, authentication events, and similar technical data used for security, auditing, troubleshooting, and performance.</li>
        </ul>
        <p>We do not intentionally collect student educational records, internal student information system data, private messages, or sensitive personal information. Canary Data is not designed to monitor private or closed Facebook groups, private social accounts, password-protected communities, or content that is not publicly accessible.</p>
      </>
    ),
  },
  {
    title: '3. How We Use Information',
    content: (
      <>
        <p style={{ marginBottom: '1rem' }}>We use information exclusively to:</p>
        <ul style={listStyle}>
          <li style={itemStyle}>Operate, maintain, and deliver the Canary Data dashboard, reports, alerts, and support services.</li>
          <li style={itemStyle}>Authenticate users, secure accounts, enforce district-level access controls, and protect customer workspaces.</li>
          <li style={itemStyle}>Retrieve, filter, summarize, classify, and present publicly accessible media and social content selected by or relevant to the customer&apos;s configuration.</li>
          <li style={itemStyle}>Generate communications-focused analysis, including sentiment, reputation risk, recommendations, and report exports.</li>
          <li style={itemStyle}>Communicate about account setup, service operations, invoices, security, support, and product updates.</li>
          <li style={itemStyle}>Improve platform reliability, accuracy, and safety without selling customer data or using one customer&apos;s confidential configuration or outputs to market to another customer.</li>
        </ul>
      </>
    ),
  },
  {
    title: '4. Public Data and Monitoring Boundaries',
    content: (
      <>
        <p style={{ marginBottom: '1rem' }}>Canary Data is a public media and digital monitoring tool. Our intent is to surface information a district communications team could reasonably find in publicly accessible media or public social channels, not to surveil private communities.</p>
        <ul style={listStyle}>
          <li style={itemStyle}>We do not intentionally access closed groups, private social media accounts, private parent or employee communities, or password-protected spaces.</li>
          <li style={itemStyle}>We do not provide tools for employee discipline, student discipline, law enforcement, or private individual surveillance.</li>
          <li style={itemStyle}>Recommendations are limited to communications functions such as messaging, engagement, channel strategy, reputation monitoring, and stakeholder awareness.</li>
          <li style={itemStyle}>Customers are responsible for choosing monitored terms and sources that are appropriate, lawful, and aligned with their organization&apos;s policies.</li>
        </ul>
      </>
    ),
  },
  {
    title: '5. We Do Not Sell or Share Customer Data',
    content: (
      <>
        <p style={{ marginBottom: '1rem', color: '#e2e8f0', fontWeight: 600 }}>This is non-negotiable. Canary Data does not and will never:</p>
        <ul style={listStyle}>
          <li style={itemStyle}>Sell customer data, district configuration, public-source collections, reports, or analysis outputs to any third party.</li>
          <li style={itemStyle}>Share customer data with advertisers, data brokers, or marketing partners.</li>
          <li style={itemStyle}>Use customer data to target advertising.</li>
          <li style={itemStyle}>Use one customer&apos;s private configuration, exports, or derivative outputs as a product for another customer.</li>
        </ul>
        <p>We may use trusted infrastructure and processing providers, such as hosting, database, monitoring, public-web collection, email, payment, and AI-processing vendors, only as needed to operate Canary Data. These providers are authorized to process information solely for service delivery, security, support, and platform operations.</p>
      </>
    ),
  },
  {
    title: '6. Data Security and Protection of Analysis',
    content: (
      <>
        <p style={{ marginBottom: '1rem' }}>We recognize that aggregated monitoring data and derivative analysis can become valuable and sensitive because it reflects an organization&apos;s issues, risks, priorities, and public narrative. We protect both source data and analysis outputs through administrative, technical, and organizational safeguards.</p>
        <ul style={listStyle}>
          <li style={itemStyle}>Data is encrypted in transit using HTTPS/TLS and encrypted at rest by our infrastructure providers.</li>
          <li style={itemStyle}>Customer workspaces are separated by district or organization, with access limited to authorized users.</li>
          <li style={itemStyle}>Production access is limited to authorized Canary Data personnel and service providers who need access to operate, secure, or support the platform.</li>
          <li style={itemStyle}>We use role-based access, logging, and operational controls designed to reduce unauthorized access and support investigation if an issue occurs.</li>
          <li style={itemStyle}>We review platform logic and data workflows to reduce inaccurate or off-geo results that could create misleading analysis for customers.</li>
        </ul>
      </>
    ),
  },
  {
    title: '7. Security Incidents and Breach Notification',
    content: (
      <p>
        If we become aware of unauthorized access to customer information or a security incident that legally requires notification, we will investigate promptly, take appropriate steps to contain and remediate the issue, and notify affected customers in accordance with applicable law and contractual obligations. Notification timing and content may vary by state and circumstance, but our intent is to communicate without unreasonable delay while preserving the integrity of the investigation and any required remediation.
      </p>
    ),
  },
  {
    title: '8. Data Retention and Deletion',
    content: (
      <p>
        We retain account information, district configuration, collected public content, reports, exports, and derivative analysis for the duration of the customer relationship unless a different retention period is agreed in writing. Upon cancellation or written request, we will delete or de-identify customer account and district data within a commercially reasonable period, unless retention is required for legal, security, billing, backup, or dispute-resolution purposes. Aggregated, non-identifiable technical logs may be retained for security and platform reliability.
      </p>
    ),
  },
  {
    title: '9. Your Rights and Customer Control',
    content: (
      <>
        <p style={{ marginBottom: '1rem' }}>Customers may request to:</p>
        <ul style={listStyle}>
          <li style={itemStyle}>Review the account, district configuration, and report data associated with their organization.</li>
          <li style={itemStyle}>Correct inaccurate account or configuration information.</li>
          <li style={itemStyle}>Remove monitored terms, sources, users, or districts.</li>
          <li style={itemStyle}>Request deletion or export of customer data, subject to applicable law and contractual requirements.</li>
          <li style={itemStyle}>Opt out of non-essential communications.</li>
        </ul>
        <p>To exercise these rights, email <a href="mailto:privacy@canarydata.media" style={linkStyle}>privacy@canarydata.media</a>. We will respond within a reasonable timeframe.</p>
      </>
    ),
  },
  {
    title: '10. FERPA, COPPA, and Student Data',
    content: (
      <p>
        Canary Data does not collect, process, or store student educational records or student information from internal school systems. The platform monitors publicly accessible media and social content about districts and public institutions. Canary Data is not intended to be used as a student record system, student profile, disciplinary tool, or child-directed service, and it is not designed to collect information from children under 13.
      </p>
    ),
  },
  {
    title: '11. Changes to This Policy',
    content: (
      <p>
        If we make material changes to this policy, we will update the “Last Updated” date and notify subscribers by email or in-product notice when appropriate. Continued use of the service after an updated policy is posted or communicated constitutes acceptance of the updated policy.
      </p>
    ),
  },
];
