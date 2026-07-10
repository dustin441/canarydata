import Link from 'next/link';
import Header from './Header';
import styles from './page.module.css';

export const metadata = {
  title: 'Canary Data | Strategic Communications Intelligence for School Districts',
  description: 'Turn daily public coverage into awareness, strategy, and leadership-ready reporting for school districts.',
};

const testimonials = [
  {
    quote: 'I am sold. I think it’s amazing. I really like that it gives you a starting point.',
    detail: 'Nicole highlighted the value of having news and social signals organized quickly, especially for a one-person communications shop that does not have time to scroll every channel manually.',
    name: 'Nicole Wheeler',
    role: 'School communicator, Alabama',
  },
  {
    quote: 'Had I had this tool when I encountered an employee crisis situation, the recommendations would have been spot on and perfect for me to have used at the time.',
    detail: 'Cindy pointed to Canary Data’s recommendations, crisis interpretation, and school-PR nuance as practical support for experienced and newer communicators alike.',
    name: 'Cindy Warner',
    role: 'School communicator, Alabama',
  },
  {
    quote: 'This just seems like such a game changer for me. It is so much more in depth.',
    detail: 'Merrick pointed to strategic alignment, social awareness, and training value as practical ways Canary Data can help communications teams show impact and coach school-level communicators.',
    name: 'Merrick Wilson',
    role: 'School communicator, Alabama',
  },
  {
    quote: 'This is a good training tool for those who may not be strategic thinking as of yet.',
    detail: 'Early feedback reinforced that Canary Data is useful not just for monitoring coverage, but for helping teams learn how to think strategically about community trust and response timing.',
    name: 'Early reviewer feedback',
    role: 'School communications leaders',
  },
];

export default function Home() {
  return (
    <div className={styles.container}>
      {/* Header */}
      <Header />

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroBackground}></div>
        <div className={styles.heroContent}>
          <h1 className={styles.title}>Strategic Communications Intelligence for School Districts</h1>
          <p className={styles.subtitle}>
            Canary Data turns daily public coverage into awareness, strategy, and leadership-ready reporting — so school teams can see what is being said, understand what it means, and show how communications advance district priorities.
          </p>
          <div className={styles.heroButtons}>
            <Link href="/demo" className={styles.primaryBtn}>Try the Demo Dashboard</Link>
            <a href="mailto:hello@canarydata.media" className={styles.secondaryBtn}>Talk to Us</a>
          </div>
        </div>
      </section>

      {/* The Differentiator */}
      <section id="features" className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.badge}>Awareness → Strategy → Leadership</span>
          <h2 className={styles.sectionTitle}>More than media monitoring</h2>
          <p className={styles.sectionDesc}>
            Most monitoring tools stop at clips and mentions. Canary Data connects relevant coverage to sentiment, Strategic Alignment, earned media, and practical next steps so communicators can brief leadership with clarity.
          </p>
        </div>

        <div className={styles.vsFeature}>
          <div className={styles.vsText}>
            <h3 className={styles.cardTitle}>Hyper-Local Precision</h3>
            <p className={styles.cardText} style={{ marginBottom: '1.5rem' }}>
              Many districts share similar school names, mascots, acronyms, and community names. Canary Data uses district geography, school anchors, source context, and exclusion rules to reduce irrelevant results and keep lookalike districts out of your daily review.
            </p>
            <p className={styles.cardText}>
              The goal is simple: what you see is actually about you.
            </p>
          </div>
          <div className={styles.vsVisual}>
            <div className={styles.competitorBox}>
              <h4>The Other Guys</h4>
              <p>📍 Loose Match: &quot;Beacon Ridge High wins state&quot; (wrong state, wrong district)</p>
            </div>
            <div className={styles.canaryBox}>
              <h4>Canary Data</h4>
              <p>📍 Verified Match: &quot;Canary Falls USD launches new STEM program in Canary County.&quot;</p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Grid */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.badge}>Fueled by school-communications context</span>
          <h2 className={styles.sectionTitle}>A thought partner for district communications</h2>
        </div>
        
        <div className={styles.grid}>
          <div className={styles.card}>
            <div className={styles.cardIcon}>🧠</div>
            <h3 className={styles.cardTitle}>Smart Summaries</h3>
            <p className={styles.cardText}>
              Canary Data summarizes daily mentions so you can understand what’s being said in seconds.
            </p>
          </div>
          <div className={styles.card}>
            <div className={styles.cardIcon}>🎯</div>
            <h3 className={styles.cardTitle}>Strategic Communication Recommendations</h3>
            <p className={styles.cardText}>
              When something matters, you don’t start from scratch. Canary Data provides strategic communication recommendations grounded in context and sentiment to guide next steps.
            </p>
          </div>
          <div className={styles.card}>
            <div className={styles.cardIcon}>📈</div>
            <h3 className={styles.cardTitle}>Sentiment</h3>
            <p className={styles.cardText}>
              Each item includes sentiment, which reflects how stories are being received — positive, neutral, or concerning — so you can quickly understand what deserves attention.
            </p>
          </div>
          <div className={styles.card}>
            <div className={styles.cardIcon}>📱</div>
            <h3 className={styles.cardTitle}>Public Social Awareness</h3>
            <p className={styles.cardText}>
              Each daily review includes publicly available social conversations alongside news coverage so you can understand what your community is seeing and discussing.
            </p>
          </div>
        </div>
      </section>

      {/* Built for school communications */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.badge}>Built for the reality of school communications</span>
          <h2 className={styles.sectionTitle}>Give leadership more than screenshots and gut feel.</h2>
          <p className={styles.sectionDesc}>
            Most weeks bring multiple priorities at once. Canary Data helps teams quickly understand what was said, how it was received, whether action is needed, and how coverage connects to the strategic goals superintendents and boards already care about.
          </p>
        </div>
      </section>

      {/* Demo Dashboard */}
      <section id="demo" className={styles.demoSection}>
        <div className={styles.demoContent}>
          <span className={styles.badge}>See It in Action</span>
          <h2 className={styles.sectionTitle}>What You’ll See Inside Canary Data</h2>
          <p className={styles.sectionDesc}>
            Show prospects how Canary Data turns messy coverage into a practical daily briefing: what happened, why it matters, whether action is needed, and how to communicate next.
          </p>

          <div className={styles.demoShell}>
            <div className={styles.demoTopBar}>
              <div>
                <p className={styles.demoEyebrow}>Canary Falls Unified School District</p>
                <h3>Communications Intelligence Dashboard</h3>
              </div>
              <Link href="/demo" className={styles.demoExport}>Open Live Demo</Link>
            </div>

            <div className={styles.metricGrid}>
              <div className={styles.metricCard}><span>Total Mentions</span><strong>16</strong><small>Visible in the demo dashboard</small></div>
              <div className={styles.metricCard}><span>Avg. Sentiment Score</span><strong>6.6</strong><small>Concern / Neutral / Positive</small></div>
              <div className={styles.metricCard}><span>Strategic Hits</span><strong>9</strong><small>Coverage tied to district priorities</small></div>
              <div className={styles.metricCard}><span>Earned Media</span><strong>6</strong><small>Proactive coverage wins</small></div>
            </div>

            <div className={styles.demoColumns}>
              <div className={styles.demoPanel}>
                <h4>Stories to Review</h4>
                <div className={styles.storyItem}>
                  <span className={styles.scoreConcerning}>Score: 3.9<br/>Concerning</span>
                  <div>
                    <strong>Bus-route change sparks parent concerns</strong>
                    <p>Recommendation: acknowledge concerns, explain the decision timeline, and publish a FAQ before the next board meeting.</p>
                  </div>
                </div>
                <div className={styles.storyItem}>
                  <span className={styles.scorePositive}>Score: 8.8<br/>Positive</span>
                  <div>
                    <strong>Voters approve school facility investment</strong>
                    <p>Recommendation: amplify as a community-trust milestone and connect the investment to student impact.</p>
                  </div>
                </div>
                <div className={styles.storyItem}>
                  <span className={styles.scoreNeutral}>Score: 5.6<br/>Neutral</span>
                  <div>
                    <strong>Routine classroom celebration post</strong>
                    <p>No immediate communications action recommended. Continue routine monitoring.</p>
                  </div>
                </div>
              </div>

              <div className={styles.demoPanel}>
                <h4>Current launch features</h4>
                <ul className={styles.demoList}>
                  <li>Geo-validation keeps lookalike districts out of the feed.</li>
                  <li>News and public social sources can be filtered separately or viewed as an aggregate Social feed.</li>
                  <li>Strategic recommendations stay focused on communications action, not student discipline or private surveillance.</li>
                  <li>Earned-story counts help teams show coverage wins without overcomplicating launch metrics.</li>
                  <li>PDF export, notes, feedback, and stakeholder-ready reports support cabinet and board updates.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className={styles.testimonialsSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.badge}>Early District Feedback</span>
          <h2 className={styles.sectionTitle}>Built with school communicators, not around them.</h2>
          <p className={styles.sectionDesc}>
            Early reviewers are validating the same promise Canary Data was built around: less noise, faster context, and recommendations that understand the nuance of school communications.
          </p>
        </div>
        <div className={styles.testimonialGrid}>
          {testimonials.map((testimonial) => (
            <figure className={styles.testimonialCard} key={testimonial.quote}>
              <blockquote>“{testimonial.quote}”</blockquote>
              <p>{testimonial.detail}</p>
              <figcaption>
                <strong>{testimonial.name}</strong>
                <span>{testimonial.role}</span>
              </figcaption>
            </figure>
          ))}
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
            <li>Hyper-Local Geographic Context Filtering</li>
            <li>News and Public Social Monitoring</li>
            <li>Mission-Aligned AI Suggestions</li>
            <li>PDF Report Export</li>
            <li>Intuitive, Zero-Learning-Curve Dashboard</li>
          </ul>
          <Link href="/demo" className={styles.primaryBtn} style={{ display: 'block' }}>Try the Demo Dashboard</Link>
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
            We believe in our product. Start your 30-day free trial today—no payment upfront, no barriers to entry. We know school district payment cycles take time, so we&apos;re giving you full access now. Just submit payment within 30 days to keep monitoring without interruption. We&apos;ll provide a price quote that you can use for approval, then payment can be made by check, ACH, or credit card. Let&apos;s get started!
          </p>
        </div>
      </section>

      <footer className={styles.footer}>
        <p>© {new Date().getFullYear()} Canary Data. AI-Driven Brand Intelligence. &nbsp;·&nbsp; <Link href="/privacy" style={{ color: '#64748b', textDecoration: 'none' }}>Privacy Policy</Link></p>
      </footer>
    </div>
  );
}
