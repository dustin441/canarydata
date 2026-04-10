import Link from 'next/link';
import Image from 'next/image';
import styles from './page.module.css';

export const metadata = {
  title: 'Canary Data | AI-Powered Intelligence for Your Brand',
  description: 'Track news, Facebook, Instagram, and TikTok with AI-powered summaries and actionable insights mapped to your mission and values.',
};

export default function Home() {
  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logo}>
          <Image src="/canary-logo.svg" alt="Canary Data" width={280} height={60} priority style={{ height: '44px', width: 'auto' }} />
        </div>
        <nav className={styles.nav}>
          <Link href="#features">Features</Link>
          <Link href="#pricing">Pricing</Link>
          <Link href="/login">Login</Link>
        </nav>
      </header>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroBackground}></div>
        <div className={styles.heroContent}>
          <h1 className={styles.title}>See everything said about your district. Instantly.</h1>
          <p className={styles.subtitle}>
            Track news, Facebook, Instagram, and TikTok. Our AI automatically summarizes the daily mentions and generates actionable recommendations tied directly to your mission and values.
          </p>
          <div className={styles.heroButtons}>
            <Link href="/login" className={styles.primaryBtn}>Start Tracking Today</Link>
            <Link href="/login" className={styles.secondaryBtn}>See the Dashboard</Link>
          </div>
        </div>
      </section>

      {/* The Differentiator */}
      <section id="features" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.badge}>Our Differentiator</span>
          <h2 className={styles.sectionTitle}>Stop Drowning in Irrelevant National News</h2>
          <p className={styles.sectionDesc}>
            While legacy media monitoring platforms give you a noisy feed of every school in the country, we fold rigorous GEO context into your search, surfacing information from your community.
          </p>
        </div>

        <div className={styles.vsFeature}>
          <div className={styles.vsText}>
            <h3 className={styles.cardTitle}>Hyper-Local Precision</h3>
            <p className={styles.cardText} style={{ marginBottom: '1.5rem' }}>
              Central High School has hundreds of locations across the United States. We filter mentions by specific counties, ZIP codes, and cities, ensuring that 100% of the articles you see are actually about <em>your</em> district. 
            </p>
            <p className={styles.cardText}>
              More context means refined searches, fewer false positives, and highly relevant intelligence immediately at your fingertips.
            </p>
          </div>
          <div className={styles.vsVisual}>
            <div className={styles.competitorBox}>
              <h4>The Other Guys</h4>
              <p>📍 National Match: &quot;Central High wins state&quot; (Wrong state, wrong school)</p>
            </div>
            <div className={styles.canaryBox}>
              <h4>Canary Data</h4>
              <p>📍 Local Match: &quot;Central High (Marion County, 32162) launches new STEM program.&quot;</p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Grid */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.badge}>Fueled by AI</span>
          <h2 className={styles.sectionTitle}>Intelligence, Not Just Data</h2>
        </div>
        
        <div className={styles.grid}>
          <div className={styles.card}>
            <div className={styles.cardIcon}>🧠</div>
            <h3 className={styles.cardTitle}>Smart Summaries</h3>
            <p className={styles.cardText}>
              Don&apos;t have time to read 40 articles? Our AI analyzes the entire text and produces concise, objective summaries of what&apos;s being said about your district online.
            </p>
          </div>
          <div className={styles.card}>
            <div className={styles.cardIcon}>🎯</div>
            <h3 className={styles.cardTitle}>Mission-Aligned Suggestions</h3>
            <p className={styles.cardText}>
              We analyze the sentiment and context of online mentions, giving you specific suggestions on how to respond and align the narrative with your district&apos;s strategic direction.
            </p>
          </div>
          <div className={styles.card}>
            <div className={styles.cardIcon}>📱</div>
            <h3 className={styles.cardTitle}>Total Social Coverage</h3>
            <p className={styles.cardText}>
              We don&apos;t just track traditional news. Bring in active conversations happening right now across Facebook, Instagram, and TikTok into an intuitive, custom dashboard.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className={styles.pricing}>
        <div className={styles.sectionHeader}>
          <span className={styles.badge}>Disruptive Value</span>
          <h2 className={styles.sectionTitle}>Maximum Intelligence.<br/>Minimum Budget Impact.</h2>
          <p className={styles.sectionDesc}>
            Because we are natively built on AI from the ground up, we cut out the massive overhead of bloated, outdated platforms and pass the savings entirely to you.
          </p>
        </div>

        <div className={styles.priceCard}>
          <div className={styles.priceSub}>Comprehensive Annual Access</div>
          <div className={styles.priceAmount}>$1,499<span style={{ fontSize: '2rem', color: '#64748b' }}>/yr</span></div>
          <ul className={styles.priceList}>
            <li>Unlimited Users</li>
            <li>AI-Summarized Daily Mentions</li>
            <li>Hyper-Local GEO Context Filtering</li>
            <li>News, Facebook, Instagram, & TikTok</li>
            <li>Mission-Aligned AI Suggestions</li>
            <li>Intuitive, Zero-Learning-Curve Dashboard</li>
          </ul>
          <Link href="/login" className={styles.primaryBtn} style={{ display: 'block' }}>Get Started Today</Link>
          <div style={{
            marginTop: '1.5rem',
            padding: '1rem 1.25rem',
            background: 'rgba(16,185,129,0.06)',
            border: '1px solid rgba(16,185,129,0.2)',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.65rem',
            textAlign: 'left',
          }}>
            <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '1px' }}>🔒</span>
            <p style={{ margin: 0, fontSize: '0.88rem', color: '#94a3b8', lineHeight: '1.6' }}>
              We will never sell or share your data.{' '}
              <Link href="/privacy" style={{ color: '#34d399', textDecoration: 'none', fontWeight: 600 }}>
                Read our Privacy Policy →
              </Link>
            </p>
          </div>
          <p style={{ marginTop: '1.5rem', fontSize: '0.9rem', color: '#94a3b8', lineHeight: '1.6' }}>
            Start your 30-day free trial today. During this trial period, you&apos;ll need to submit your payment to continue service. We&apos;ll send you an invoice that you can pay by check, ACH, or credit card. Please ensure your payment is received within the 30-day trial window. We&apos;re happy to work with you on any questions or assistance you need during this process. Let&apos;s get you set up!
          </p>
        </div>
      </section>

      <footer className={styles.footer}>
        <p>© {new Date().getFullYear()} Canary Data. AI-Driven Brand Intelligence. &nbsp;·&nbsp; <Link href="/privacy" style={{ color: '#64748b', textDecoration: 'none' }}>Privacy Policy</Link></p>
      </footer>
    </div>
  );
}
