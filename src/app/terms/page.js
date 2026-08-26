import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'Terms of Service | Canary Data',
  description: 'Terms governing access to and use of the Canary Data communications intelligence platform.',
};

const linkStyle = { color: '#22d3ee', textDecoration: 'none' };
const sectionStyle = { marginBottom: '3rem' };
const headingStyle = {
  fontSize: '1.4rem',
  fontWeight: 700,
  color: '#f8fafc',
  marginBottom: '1rem',
  paddingBottom: '0.75rem',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};
const bodyStyle = { color: '#94a3b8', lineHeight: '1.8', fontSize: '1.05rem' };
const listStyle = { paddingLeft: '1.5rem', marginBottom: '1rem' };
const itemStyle = { marginBottom: '0.5rem' };

export default function TermsOfService() {
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
        <h1 style={{ fontSize: '2.8rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-1px', marginBottom: '0.5rem' }}>
          Terms of Service
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.95rem', marginBottom: '3.5rem' }}>
          Effective Date: August 26, 2026 &nbsp;·&nbsp; Last Updated: August 26, 2026
        </p>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>1. Agreement to These Terms</h2>
          <div style={bodyStyle}>
            <p>These Terms of Service govern access to and use of Canary Data, a communications intelligence service operated by Canary Data LLC. By creating an account, accepting an order, or using the service, the customer organization and its authorized users agree to these Terms and the <Link href="/privacy" style={linkStyle}>Privacy Policy</Link>.</p>
            <p>If you use Canary Data for an organization, you represent that you are authorized to accept these Terms on its behalf.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>2. The Service</h2>
          <div style={bodyStyle}>
            <p>Canary Data helps school districts and other public-sector organizations monitor and analyze public news, public social content, customer-authorized owned social accounts, and communications outcomes. Features may include collection, filtering, summaries, sentiment, risk indicators, recommendations, reports, exports, alerts, and Page or Instagram performance reporting.</p>
            <p>Canary Data supports professional communications judgment; it does not replace legal, safety, personnel, public-records, or crisis-management advice.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>3. Accounts and Authorized Use</h2>
          <div style={bodyStyle}>
            <ul style={listStyle}>
              <li style={itemStyle}>Customers must provide accurate account information and keep login credentials secure.</li>
              <li style={itemStyle}>Access is limited to authorized personnel acting for the subscribing organization.</li>
              <li style={itemStyle}>Customers are responsible for user access, configured monitoring terms, connected accounts, and activity performed through their workspace.</li>
              <li style={itemStyle}>Canary Data may suspend access reasonably believed to be compromised, unlawful, abusive, or materially harmful to the service or another customer.</li>
            </ul>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>4. Acceptable Use</h2>
          <div style={bodyStyle}>
            <p>Customers may not use Canary Data to unlawfully surveil individuals, access private or restricted communities, violate platform terms, infringe intellectual-property or privacy rights, transmit malicious code, interfere with the service, circumvent access controls, resell unauthorized access, or use outputs as the sole basis for student discipline, employee discipline, law enforcement, or other high-impact decisions.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>5. Connected Services and Meta</h2>
          <div style={bodyStyle}>
            <p>A customer may authorize Canary Data to access Facebook Pages and connected Instagram professional accounts that the authorizing user is permitted to manage. Canary may read selected owned posts, media, and available organic performance insights for district-controlled reporting.</p>
            <ul style={listStyle}>
              <li style={itemStyle}>The customer controls which eligible assets are selected.</li>
              <li style={itemStyle}>Canary does not use the connection to publish, manage advertisements, send messages, or manage comments.</li>
              <li style={itemStyle}>The customer may disconnect the integration in Canary or remove it through Meta.</li>
              <li style={itemStyle}>Use of Meta and other third-party services remains subject to those providers&apos; terms, availability, permissions, and technical limits.</li>
            </ul>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>6. Customer Data and Privacy</h2>
          <div style={bodyStyle}>
            <p>As between the parties, the customer retains its rights in customer-provided account information, configuration, connected-account selections, and non-public work product. Canary retains its rights in the platform, software, methods, and generalized service improvements that do not identify a customer or disclose its confidential information.</p>
            <p>Our collection, use, retention, security, and deletion practices are described in the <Link href="/privacy" style={linkStyle}>Privacy Policy</Link>. Canary Data does not sell customer data or use it for targeted advertising.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>7. Public and Third-Party Content</h2>
          <div style={bodyStyle}>
            <p>News, public posts, links, trademarks, and other third-party materials remain owned by their respective owners. Availability may change, and sources may be incomplete, corrected, removed, delayed, or inaccurate. Customers remain responsible for reviewing source material before relying on it publicly.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>8. Automated Analysis</h2>
          <div style={bodyStyle}>
            <p>Summaries, sentiment, risk indicators, recommendations, and other automated analysis may contain errors or require context. They are decision-support outputs, not guarantees of accuracy or professional advice. Customers should apply qualified human review before taking consequential action.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>9. Fees, Renewals, and Taxes</h2>
          <div style={bodyStyle}>
            <p>Fees, subscription periods, payment terms, and any renewal terms are stated in the applicable order, invoice, or checkout flow. Unless the applicable order states otherwise, fees are non-refundable except where required by law. Customers are responsible for applicable taxes other than taxes on Canary Data&apos;s net income.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>10. Service Changes and Availability</h2>
          <div style={bodyStyle}>
            <p>We may improve, replace, limit, or discontinue features as providers, laws, or customer needs change. We aim to provide reliable service but do not guarantee uninterrupted availability. Planned or emergency maintenance, provider outages, rate limits, and source changes may affect collection or reporting.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>11. Confidentiality</h2>
          <div style={bodyStyle}>
            <p>Each party will use reasonable care to protect the other party&apos;s non-public business, technical, security, and customer information and will use it only to perform or receive the service, comply with law, or protect rights and security. Confidential information does not include information that is public through no breach, independently developed, or lawfully received without restriction.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>12. Suspension and Termination</h2>
          <div style={bodyStyle}>
            <p>A customer may stop using the service and may disconnect third-party integrations at any time. Either party may terminate as allowed by the applicable order. Canary may suspend or terminate access for material breach, nonpayment, security risk, unlawful use, or conduct that threatens the service or others. Data handling after termination follows the applicable agreement and Privacy Policy.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>13. Disclaimers</h2>
          <div style={bodyStyle}>
            <p>To the maximum extent permitted by law, Canary Data is provided on an “as is” and “as available” basis. Canary disclaims implied warranties of merchantability, fitness for a particular purpose, non-infringement, and warranties arising from course of dealing. We do not warrant that every relevant source or item will be found or that every analysis will be complete or error-free.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>14. Limitation of Liability</h2>
          <div style={bodyStyle}>
            <p>To the maximum extent permitted by law, neither party will be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, revenues, goodwill, or data. Canary Data&apos;s total liability arising from the service will not exceed the fees paid or payable by the customer for the service during the twelve months before the event giving rise to the claim. These limits do not apply where prohibited by law.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>15. Governing Law</h2>
          <div style={bodyStyle}>
            <p>These Terms are governed by the laws of the State of Arizona, without regard to conflict-of-law rules. The state and federal courts located in Arizona will have exclusive jurisdiction unless an applicable written agreement states otherwise.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>16. Changes to These Terms</h2>
          <div style={bodyStyle}>
            <p>We may update these Terms as the service or applicable requirements change. We will update the “Last Updated” date and provide additional notice for material changes when appropriate. Continued use after updated Terms take effect constitutes acceptance to the extent permitted by law.</p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>17. Contact</h2>
          <div style={bodyStyle}>
            <p>Questions about these Terms may be sent to <a href="mailto:hello@canarydata.media" style={linkStyle}>hello@canarydata.media</a>. Privacy or deletion questions may be sent to <a href="mailto:privacy@canarydata.media" style={linkStyle}>privacy@canarydata.media</a>.</p>
          </div>
        </section>
      </main>

      <footer style={{
        borderTop: '1px solid rgba(255,255,255,0.05)',
        padding: '3rem 5%',
        textAlign: 'center',
        color: '#64748b',
        fontSize: '0.9rem',
      }}>
        <p>© {new Date().getFullYear()} Canary Data. &nbsp;·&nbsp; <Link href="/privacy" style={{ color: '#64748b', textDecoration: 'none' }}>Privacy Policy</Link> &nbsp;·&nbsp; <Link href="/" style={{ color: '#64748b', textDecoration: 'none' }}>Home</Link></p>
      </footer>
    </div>
  );
}
