import Link from 'next/link';
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
          <svg width="36" height="30" viewBox="0 0 36 30" fill="none">
            <ellipse cx="14" cy="20" rx="11" ry="8" fill="#facc15"/>
            <circle cx="24" cy="13" r="6" fill="#facc15"/>
            <circle cx="26" cy="11.5" r="1.4" fill="#0B1120"/>
            <path d="M30 13 L36 11 L30 16Z" fill="#facc15"/>
            <path d="M3 20 L0 27 L7 23Z" fill="#facc15"/>
            <rect x="11" y="8" width="3" height="11" rx="1" fill="rgba(255,255,255,0.85)"/>
            <rect x="15.5" y="5" width="3" height="14" rx="1" fill="rgba(255,255,255,0.85)"/>
            <rect x="20" y="2" width="3" height="17" rx="1" fill="rgba(255,255,255,0.85)"/>
          </svg>
          <span>Canary</span><span style={{color:'#fff', fontWeight:400}}> Data</span>
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
          <p style={{ marginTop: '1.5rem', fontSize: '0.9rem', color: '#94a3b8', lineHeight: '1.6' }}>
            Start your 30-day free trial today. During this trial period, you&apos;ll need to submit your payment to continue service. We&apos;ll send you an invoice that you can pay by check, ACH, or credit card. Please ensure your payment is received within the 30-day trial window. We&apos;re happy to work with you on any questions or assistance you need during this process. Let&apos;s get you set up!
          </p>
        </div>
      </section>

      <footer className={styles.footer}>
        <p>© {new Date().getFullYear()} Canary Data. AI-Driven Brand Intelligence.</p>
      </footer>
    </div>
  );
}
