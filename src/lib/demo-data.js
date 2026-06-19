export const demoDistricts = [
  { id: 'canary-falls-usd', name: 'Canary Falls Unified School District' },
];

export const demoQueries = [
  { id: 'demo-q-1', query_text: '"Canary Falls Unified School District" community programs', district_id: 'canary-falls-usd', district_name: 'Canary Falls Unified School District', geo_city: 'Canary Falls', geo_state: 'Demo State', geo_zip: '00000', channels: 'news', active: true, created_at: '2026-05-01' },
  { id: 'demo-q-2', query_text: '"Beacon Ridge High" family engagement', district_id: 'canary-falls-usd', district_name: 'Canary Falls Unified School District', geo_city: 'Canary Falls', geo_state: 'Demo State', geo_zip: '00000', channels: 'news', active: true, created_at: '2026-05-01' },
  { id: 'demo-q-3', query_text: 'Beacon Ridge High student achievement social', district_id: 'canary-falls-usd', district_name: 'Canary Falls Unified School District', geo_city: 'Canary Falls', geo_state: 'Demo State', geo_zip: '00000', channels: 'social', active: true, created_at: '2026-05-03' },
  { id: 'demo-q-4', query_text: 'Canary Falls Unified School District FAFSA graduation', district_id: 'canary-falls-usd', district_name: 'Canary Falls Unified School District', geo_city: 'Canary Falls', geo_state: 'Demo State', geo_zip: '00000', channels: 'all', active: true, created_at: '2026-05-05' },
  { id: 'demo-q-5', query_text: 'Canary Falls lookalike district validation examples', district_id: 'canary-falls-usd', district_name: 'Canary Falls Unified School District', geo_city: '', geo_state: '', geo_zip: '', channels: 'news', active: true, created_at: '2026-05-06' },
  { id: 'demo-q-6', query_text: 'Beacon Ridge High lockdown safety communication', district_id: 'canary-falls-usd', district_name: 'Canary Falls Unified School District', geo_city: 'Canary Falls', geo_state: 'Demo State', geo_zip: '00000', channels: 'news', active: true, created_at: '2026-06-11' },
];

export const demoArticles = [
  {
    id: 'demo-001', date: '2026-06-10', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Education Daily',
    headline: 'Beacon Ridge High School expands bilingual family resource nights for incoming freshmen',
    summary: 'Beacon Ridge High School announced a monthly evening series for incoming freshmen families, with translation support, counseling staff, and campus tours focused on easing the ninth-grade transition.',
    link: 'https://example.com/demo/beacon-ridge-family-resource-nights', canary_score: 8.7,
    tags: ['Engagement', 'Academic Success'], notes: 'Analyst note: Good owned-channel story to amplify before freshman orientation; include translation access in every post.', is_earned_media: true, is_perched: false,
    innovation_reason: 'Proactive multilingual family engagement that supports belonging before the ninth-grade transition.',
    recommendation: `**Strategic Intent**
Turn a positive service update into a trust-building enrollment message.

**Audience Focus**
Incoming freshmen families, multilingual households, counselors, campus staff.

**Message Angle**
Beacon Ridge is reducing transition friction and making family support easy to access.

**Channel Strategy**
District social, family email, school website, and counselor/principal talking points.

**Execution Plan**
Publish a short event post with registration details, translation availability, and a principal quote about belonging; add the dates to the orientation page.

**Guardrails**
Avoid implying this is only for families already struggling; frame it as a universal support.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-016', date: '2026-06-10', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Safety Bulletin Demo',
    headline: 'Beacon Ridge High enters brief lockdown after police activity reported near campus',
    summary: 'Beacon Ridge High School was placed in a brief precautionary lockdown after police activity was reported several blocks from campus. No students or staff were injured, and the school resumed normal operations after law enforcement cleared the area.',
    link: 'https://example.com/demo/brief-lockdown-safety-update', canary_score: 2.7,
    tags: ['Safety & Wellness', 'Engagement'], notes: 'Analyst note: High-sensitivity safety scenario; use as the demo example for fast, clear family-first communication.', is_earned_media: false, is_perched: false,
    innovation_reason: 'N/A',
    recommendation: `**Strategic Intent**
Protect trust during a safety incident by communicating quickly, calmly, and factually.

**Audience Focus**
Families and staff first; then local media and community observers.

**Message Angle**
Students and staff are safe, the lockdown was precautionary, law enforcement cleared the scene, and the district will share confirmed updates only.

**Channel Strategy**
Parent email, SMS, website alert, social post, and a short media holding statement.

**Execution Plan**
Send an immediate notice with timeline and safety status; send an end-of-day follow-up with support resources and where families can ask questions.

**Guardrails**
Do not speculate about the off-campus police activity or overstate details beyond what law enforcement confirmed.`,
    source_query: 'Beacon Ridge High School Canary Falls lockdown safety communication',
  },
  {
    id: 'demo-002', date: '2026-06-09', district_id: 'canary-falls-usd', source_type: 'facebook', source: 'Beacon Ridge High School Facebook',
    headline: 'Photos: Beacon Ridge High robotics students demonstrate solar-powered design at community showcase',
    summary: 'The school posted photos from a student showcase where robotics students presented solar-powered prototypes to local business partners and family members.',
    link: 'https://example.com/demo/robotics-showcase', canary_score: 9.2,
    tags: ['Innovation', 'Academic Success', 'Engagement'], notes: null, is_earned_media: true, is_perched: false,
    innovation_reason: 'Student innovation story with visual proof and partner/community validation.',
    recommendation: `**Strategic Intent**
Use the robotics showcase to reinforce student innovation and career-connected learning.

**Audience Focus**
Prospective families, STEM partners, local business leaders, and current students.

**Message Angle**
Students are solving real-world problems and learning in public with community support.

**Channel Strategy**
LinkedIn, Instagram/Facebook carousel, district newsletter, and a local education reporter pitch.

**Execution Plan**
Choose one strong photo, add a student quote, tag the partner if appropriate, and invite local media to cover the next showcase.`,
    source_query: 'Beacon Ridge High Bobcats Canary Falls athletics',
  },
  {
    id: 'demo-003', date: '2026-06-08', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Neighborhood Tribune',
    headline: 'Neighbors ask for more notice around Beacon Ridge High summer parking lot construction',
    summary: 'A neighborhood story noted confusion around temporary parking restrictions tied to construction on the Beacon Ridge High campus. Residents said signs appeared after work had already started.',
    link: 'https://example.com/demo/parking-construction-notice', canary_score: 3.4,
    tags: ['Operations & Finance', 'Engagement'], notes: 'Analyst note: Preventable trust-friction item; operations and comms should coordinate same-day.', is_earned_media: false, is_perched: false,
    innovation_reason: 'N/A',
    recommendation: `**Strategic Intent**
Close the notice gap before a facilities issue becomes a broader trust issue.

**Audience Focus**
Nearby residents, families driving to campus, front-office staff, and operations.

**Message Angle**
The district heard the confusion, is clarifying the timeline, and will improve advance notice on future work.

**Channel Strategy**
Website construction update, neighborhood email if available, school social channels, and office talking points.

**Execution Plan**
Publish a same-day map/timeline/contact update and ask operations to confirm the next signage or notice milestone.

**Guardrails**
Acknowledge the timing issue without blaming contractors or residents.`,
    source_query: '"Beacon Ridge High" "Canary Falls Unified"',
  },
  {
    id: 'demo-004', date: '2026-06-07', district_id: 'canary-falls-usd', source_type: 'instagram', source: 'Beacon Ridge High Instagram',
    headline: 'Senior spotlight series celebrates first-generation college-bound students',
    summary: 'A social series highlighted seniors who will be the first in their families to attend college, including quotes about counselors, teachers, and family support.',
    link: 'https://example.com/demo/senior-spotlight', canary_score: 9.0,
    tags: ['Academic Success', 'Engagement'], notes: null, is_earned_media: true, is_perched: false,
    innovation_reason: 'Human-centered college-readiness proof point with student voice and family support.',
    recommendation: `**Strategic Intent**
Extend the senior spotlight series into a college-readiness narrative.

**Audience Focus**
Families, rising seniors, counselors, alumni, and community partners.

**Message Angle**
Student success is connected to counseling, family support, and clear postsecondary planning.

**Channel Strategy**
Instagram/Facebook series, website recap, alumni comments, and FAFSA support reminders.

**Execution Plan**
Bundle the posts into a web recap and add a callout for upcoming FAFSA or counseling supports.`,
    source_query: 'Beacon Ridge High School Canary Falls FAFSA graduation',
  },
  {
    id: 'demo-005', date: '2026-06-06', district_id: 'canary-falls-usd', source_type: 'tiktok', source: 'Canary Falls Transit Updates TikTok',
    headline: 'Morning bus detour near Beacon Avenue expected to affect Beacon Ridge High arrival traffic',
    summary: 'A public transit account announced a morning detour near campus. The post did not mention the school directly but could affect student arrival and family drop-off.',
    link: 'https://example.com/demo/bus-detour', canary_score: 5.8,
    tags: ['Operations & Finance', 'Safety & Wellness'], notes: 'Analyst note: Operational heads-up, not a reputation story; useful because it affects family logistics.', is_earned_media: false, is_perched: false,
    innovation_reason: 'N/A',
    recommendation: `**Strategic Intent**
Use an external transit signal to prevent arrival confusion.

**Audience Focus**
Families, students who ride or get dropped off, attendance office, and campus security.

**Message Angle**
A temporary detour may affect arrival; here are alternate routes and where to check updates.

**Channel Strategy**
ParentSquare/email, school website alert, and front-office script.

**Execution Plan**
Post a short morning advisory with route details and remove it once the detour clears.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-006', date: '2026-06-04', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Sports Wire',
    headline: 'Beacon Ridge High track athletes qualify for state finals after standout relay performance',
    summary: 'Beacon Ridge High student athletes qualified for state finals after a season-best relay performance, with coaches praising academic eligibility and teamwork.',
    link: 'https://example.com/demo/track-state-finals', canary_score: 8.5,
    tags: ['Academic Success', 'Engagement'], notes: null, is_earned_media: true, is_perched: false,
    innovation_reason: 'Positive student-achievement story with an academic eligibility angle beyond athletics.',
    recommendation: `**Strategic Intent**
Celebrate athletics while reinforcing academic expectations and team culture.

**Audience Focus**
Students, families, alumni, athletics supporters, and local sports media.

**Message Angle**
The relay achievement reflects preparation, eligibility, teamwork, and school pride.

**Channel Strategy**
Athletics social channels, district repost, newsletter highlight, and local sports contact.

**Execution Plan**
Publish congratulations before the state meet and gather one coach/student quote for follow-up coverage.`,
    source_query: 'Beacon Ridge High Bobcats Canary Falls athletics',
  },
  {
    id: 'demo-007', date: '2026-06-02', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Civic Watch',
    headline: 'Board agenda includes security-camera upgrade request for Beacon Ridge High campus',
    summary: 'A civic agenda preview noted an upcoming vote on campus security-camera upgrades, with parent comments split between safety benefits and privacy concerns.',
    link: 'https://example.com/demo/security-camera-agenda', canary_score: 4.2,
    tags: ['Safety & Wellness', 'Operations & Finance', 'Engagement'], notes: 'Analyst note: Board-agenda item likely needs FAQ language before public comment grows.', is_earned_media: false, is_perched: false,
    innovation_reason: 'N/A',
    recommendation: `**Strategic Intent**
Prepare a plain-language explanation before the security-camera agenda item draws concern.

**Audience Focus**
Parents, staff, privacy-sensitive community members, and board watchers.

**Message Angle**
The proposal is about safety infrastructure with clear limits on access, retention, and oversight.

**Channel Strategy**
Board preview, FAQ page, parent email, and meeting talking points.

**Execution Plan**
Publish a short FAQ covering what changes, who accesses footage, retention policy, and how questions can be submitted.

**Guardrails**
Do not dismiss privacy concerns; explain safeguards directly.`,
    source_query: '"Beacon Ridge High" "Canary Falls Unified"',
  },
  {
    id: 'demo-008', date: '2026-05-31', district_id: 'canary-falls-usd', source_type: 'facebook', source: 'Beacon Ridge High Facebook',
    headline: 'Video recap: Beacon Ridge High culinary students prepare meals for community resource fair',
    summary: 'A district video showed culinary students preparing meals for a resource fair serving families near the Beacon Ridge High campus.',
    link: 'https://example.com/demo/culinary-resource-fair', canary_score: 8.8,
    tags: ['Academic Success', 'Engagement'], notes: null, is_earned_media: true, is_perched: false,
    innovation_reason: 'Career-connected learning that also shows student service to the community.',
    recommendation: `**Strategic Intent**
Turn a visual CTE moment into a program-awareness asset.

**Audience Focus**
Current families, prospective CTE students, community partners, and local employers.

**Message Angle**
Students are building practical skills while serving families and community needs.

**Channel Strategy**
Short video clip on social, CTE program page, partner newsletter, and course-selection reminders.

**Execution Plan**
Clip a 20-second student quote, connect it to CTE enrollment, and thank the resource-fair partners.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-009', date: '2026-05-29', district_id: 'canary-falls-usd', source_type: 'news', source: 'Valley Parent Forum',
    headline: 'Parents trade tips online after Beacon Ridge High posts summer credit-recovery schedule',
    summary: 'A parent forum thread shared questions about summer credit recovery, including how families should confirm transportation, meals, and course timing.',
    link: 'https://example.com/demo/credit-recovery-questions', canary_score: 6.2,
    tags: ['Academic Success', 'Engagement'], notes: 'Analyst note: Family questions indicate the original summer-school post needs clearer logistics.', is_earned_media: false, is_perched: false,
    innovation_reason: 'N/A',
    recommendation: `**Strategic Intent**
Reduce public confusion by answering logistics in one official place.

**Audience Focus**
Families considering credit recovery, counselors, transportation, and campus office staff.

**Message Angle**
The district has a clear summer schedule and support plan; families should not have to piece it together from comments.

**Channel Strategy**
Summer school webpage, family email, and a pinned social reply linking to the FAQ.

**Execution Plan**
Add FAQ items for transportation, meals, course times, registration confirmation, and contact information.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-010', date: '2026-05-27', district_id: 'canary-falls-usd', source_type: 'instagram', source: 'Beacon Ridge High Instagram',
    headline: 'Beacon Ridge High mariachi ensemble invited to perform at downtown arts festival',
    summary: 'The school celebrated its mariachi ensemble being invited to a downtown arts festival, highlighting student practice and cultural pride.',
    link: 'https://example.com/demo/mariachi-festival', canary_score: 9.4,
    tags: ['Engagement', 'Academic Success'], notes: 'Analyst note: Strong earned-media pitch opportunity because it is visual, cultural, and student-led.', is_earned_media: true, is_perched: false,
    innovation_reason: 'Strong culture/belonging story with student voice and community visibility.',
    recommendation: `**Strategic Intent**
Use the mariachi invitation as a student-voice and culture story.

**Audience Focus**
Families, arts supporters, local media, alumni, and community partners.

**Message Angle**
Students are representing Beacon Ridge through cultural pride, performance, and disciplined practice.

**Channel Strategy**
Media pitch, photo carousel, district newsletter, and event-day reposts.

**Execution Plan**
Pitch a photo-friendly feature, collect student quotes before the event, and invite families to attend.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-011', date: '2026-05-24', district_id: 'canary-falls-usd', source_type: 'news', source: 'Demo Filter Log',
    headline: 'Filtered out: Beacon Ridge High in another state wins baseball championship',
    summary: 'This sample illustrates a lookalike mention that would be filtered out by geo-validation because the article is about a Beacon Ridge High in a different community.',
    link: 'https://example.com/demo/filtered-lookalike', canary_score: 1.8,
    tags: ['Operations & Finance'], notes: 'Analyst note: Demo-only row; keep it as a visible example of wrong-district validation logic.', is_earned_media: false, is_perched: false,
    innovation_reason: 'Shows the product differentiator: school-name matching is not enough without local context.',
    recommendation: `**Strategic Intent**
Use this as a product demo example, not a communications action item.

**Audience Focus**
Prospects evaluating data quality and district communications leaders.

**Message Angle**
Canary separates lookalike mentions from relevant local coverage before teams waste time on them.

**Channel Strategy**
Demo walkthrough and sales conversation only.

**Execution Plan**
Explain why this row is flagged/suppressed and show how geo/context validation protects dashboard trust.`,
    source_query: 'Beacon Ridge High School wrong district examples',
  },
  {
    id: 'demo-012', date: '2026-05-22', district_id: 'canary-falls-usd', source_type: 'facebook', source: 'Beacon Ridge High PTO Facebook',
    headline: 'PTO asks families to donate water bottles ahead of excessive heat advisory',
    summary: 'The PTO posted a call for water bottle donations as temperatures rise, with comments from families asking whether outdoor practices will be adjusted.',
    link: 'https://example.com/demo/heat-water-bottles', canary_score: 5.1,
    tags: ['Safety & Wellness', 'Engagement'], notes: 'Analyst note: Practical operations item; coordinate with athletics and health/safety before families ask.', is_earned_media: false, is_perched: false,
    innovation_reason: 'N/A',
    recommendation: `**Strategic Intent**
Answer heat-safety questions before they turn into parent concern.

**Audience Focus**
Families, athletes, coaches, nurses, and operations staff.

**Message Angle**
The school has a plan for water access, outdoor practice adjustments, and heat-advisory monitoring.

**Channel Strategy**
Parent email, athletics channels, school website, and coach talking points.

**Execution Plan**
Coordinate one heat-safety message and include who families should contact with medical or practice questions.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-013', date: '2026-05-20', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Business Journal Demo',
    headline: 'Local tech nonprofit funds after-school coding lab at Beacon Ridge High',
    summary: 'A technology nonprofit announced support for an after-school coding lab at Beacon Ridge High, including donated equipment and mentor hours from Canary Falls employers.',
    link: 'https://example.com/demo/coding-lab', canary_score: 9.1,
    tags: ['Innovation', 'Academic Success', 'Engagement'], notes: null, is_earned_media: true, is_perched: false,
    innovation_reason: 'High-value partnership story connecting workforce readiness with student access.',
    recommendation: `**Strategic Intent**
Position the coding lab as a workforce-readiness and partnership win.

**Audience Focus**
Prospective families, donors, employer partners, students, and board members.

**Message Angle**
The partnership expands student access to technology, mentoring, and career-connected experiences.

**Channel Strategy**
Press release, LinkedIn, website case study, board update, and partner cross-post.

**Execution Plan**
Thank the partner, capture participation numbers, and develop a short case study with student quotes.`,
    source_query: '"Beacon Ridge High" "Canary Falls Unified"',
  },
  {
    id: 'demo-014', date: '2026-05-18', district_id: 'canary-falls-usd', source_type: 'tiktok', source: 'Local Reporter Demo TikTok',
    headline: 'Reporter asks for family perspectives on Beacon Ridge High grading-policy pilot',
    summary: 'A local reporter posted a request for families willing to discuss the school grading-policy pilot, signaling possible coverage before the district has framed the issue.',
    link: 'https://example.com/demo/grading-policy-reporter', canary_score: 4.8,
    tags: ['Operations & Finance', 'Engagement'], notes: 'Analyst note: Early-warning media signal; prepare context before the article is written.', is_earned_media: false, is_perched: false,
    innovation_reason: 'N/A',
    recommendation: `**Strategic Intent**
Shape context before a grading-policy story publishes.

**Audience Focus**
Families, teachers, administrators, board members, and the reporter.

**Message Angle**
The pilot has a defined purpose, feedback loop, and criteria for success.

**Channel Strategy**
Background statement, administrator interview offer, FAQ link, and board talking points.

**Execution Plan**
Prepare three background points and offer an interview with the administrator closest to the pilot.

**Guardrails**
Do not over-defend the policy; acknowledge parent questions and explain how feedback is being reviewed.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-015', date: '2026-05-15', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Arts Calendar',
    headline: 'Beacon Ridge High students unveil mural honoring neighborhood history',
    summary: 'Students unveiled a campus mural created with local artists and community elders, connecting student art to neighborhood history.',
    link: 'https://example.com/demo/neighborhood-mural', canary_score: 8.9,
    tags: ['Engagement', 'Academic Success'], notes: null, is_earned_media: true, is_perched: false,
    innovation_reason: 'Student-voice and community-trust narrative with strong visual assets.',
    recommendation: `**Strategic Intent**
Amplify the mural as a student-voice and community-history story.

**Audience Focus**
Families, neighborhood partners, arts supporters, alumni, and local media.

**Message Angle**
Students are connecting campus identity to neighborhood history through creative work.

**Channel Strategy**
Photo carousel, website feature, partner tags, and local arts calendar/community media.

**Execution Plan**
Publish a carousel with student artist quotes and invite community partners to share the story.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
];
