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

export const demoSocialSources = [
  { id: 'demo-social-facebook', district_id: 'canary-falls-usd', platform: 'facebook', url: 'https://www.facebook.com/', handle: 'BeaconRidgeHigh', active: true },
  { id: 'demo-social-instagram', district_id: 'canary-falls-usd', platform: 'instagram', url: 'https://www.instagram.com/', handle: 'BeaconRidgeHigh', active: true },
];

export const demoArticles = [
  {
    id: 'demo-001', date: '2026-06-10', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Education Daily',
    headline: 'Beacon Ridge High School expands bilingual family resource nights for incoming freshmen',
    summary: 'Beacon Ridge High School announced a monthly evening series for incoming freshmen families, with translation support, counseling staff, and campus tours focused on easing the ninth-grade transition.',
    link: 'https://example.com/demo/beacon-ridge-family-resource-nights', canary_score: 8.7,
    tags: ['Engagement', 'Academic Success'], notes: 'Analyst note: Good owned-channel story to amplify before freshman orientation; include translation access in every post.', is_earned_media: true, is_perched: false,
    innovation_reason: '**Family Engagement** – Expanding bilingual outreach removes barriers for families and strengthens school-home partnerships during a critical student transition period.',
    recommendation: `**Strategic Intent**
Position Beacon Ridge High as a welcoming, family-centered school committed to student success before the first day of classes. Reinforce accessibility, inclusion, and proactive student support.

**Audience Focus**
**Primary:** Incoming freshmen families, multilingual households, students transitioning from middle school.
**Secondary:** Community partners, district leadership, prospective families considering enrollment.

**Message Angle**
Highlight the school's commitment to reducing anxiety, building belonging, and ensuring every family has access to information and support regardless of language or background.

**Channel Strategy**
- School and district websites, social media, feeder middle school communications, parent newsletters, community partner channels.

**Execution Plan**
- Create a campaign around "Starting Strong at Beacon Ridge." Share testimonials from counselors, current freshmen, and families. Produce short videos showcasing campus tours and support services. Promote attendance through feeder schools and community organizations.

**Guardrails**
- Avoid implying the transition is difficult for all students. Ensure translation services are accurately represented and available as advertised.

**Expected Outcome**
Increased event participation, stronger family engagement, improved perceptions of school accessibility, and smoother freshman onboarding.

**Next Phase**
Capture attendance data and feedback. Develop a freshman transition success story after the first semester using participant testimonials and outcome metrics.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-016', date: '2026-06-10', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Safety Bulletin Demo',
    headline: 'Beacon Ridge High enters brief lockdown after police activity reported near campus',
    summary: 'Beacon Ridge High School was placed in a brief precautionary lockdown after police activity was reported several blocks from campus. No students or staff were injured, and the school resumed normal operations after law enforcement cleared the area.',
    link: 'https://example.com/demo/brief-lockdown-safety-update', canary_score: 2.7,
    tags: ['Safety & Wellness', 'Engagement'], notes: 'Analyst note: High-sensitivity safety scenario; use as the demo example for fast, clear family-first communication.', is_earned_media: false, is_perched: false,
    innovation_reason: "**School Safety** – Demonstrates the district's commitment to maintaining secure learning environments through established safety protocols and emergency response procedures.",
    recommendation: `**Strategic Intent**
A false shooter report triggered a school lockdown, creating immediate safety concerns and potential community anxiety. The district must quickly confirm facts, reassure families, and clarify lockdown protocols to prevent misinformation and maintain public confidence in emergency response procedures.

**Audience Focus**
**Primary:** Parents and families of students at the affected school; local media outlets covering the incident
**Secondary:** District staff, board members, broader Canary Falls USD community, law enforcement partners

**Message Angle**
Acknowledge the incident promptly and factually. Emphasize that district emergency protocols worked as designed, that students and staff are safe, and provide clarity on what triggered the lockdown. Tone should be calm, professional, and reassuring—avoiding defensiveness while demonstrating competent crisis response.

**Channel Strategy**
- District website homepage with incident summary and all-clear statement
- Direct email/text alert to affected school families with facts and reassurance
- Social media (Facebook, X) with brief factual post and link to full statement
- Prepare spokesperson for local media and other outlets already covering
- Internal communication to all staff with talking points

**Execution Plan**
- Issue a holding statement within 2 hours confirming the lockdown occurred, that it was in response to 911 reports, that no threat was found, and that all students/staff are safe
- Coordinate with Canary Falls law enforcement to confirm their preliminary findings and clarify the nature of the false reports
- Assess whether misinformation or incorrect details are circulating on local social media; if so, flag inaccurate posts to Meta/Facebook for review
- Request an editorial or call-in opportunity with ABC affiliate to provide full context on how the district's lockdown protocols operated and why they were effective
- Prepare FAQ addressing common parent concerns: How was the threat assessed? When were students released? What happens next?
- Monitor social media and news comments for rumor spread; have comms team ready to respond to factually incorrect claims with corrections

**Guardrails**
- Do NOT speculate on the identity or motive of those who made false reports
- Do NOT blame 911 callers; frame as community members reporting concerns in good faith
- Do NOT discuss specific lockdown procedures in public statements (security operational detail)
- Avoid defensive language; focus on competence and student safety
- Coordinate all external statements through superintendent or designated spokesperson

**Expected Outcome**
Families understand the incident was false, trust district emergency response, and feel confident in school safety protocols. Media coverage shifts from alarm to reassurance, and misinformation is contained before it spreads further.

**Next Phase**
Monitor local news for follow-up stories over the next 24–48 hours. If media requests school safety statistics, lockdown drill frequency, or protocol details, have superintendent ready for interview. If parent concerns escalate, consider a brief follow-up message reaffirming safety measures. Document incident response for internal after-action review with building administration and law enforcement partners.`,
    source_query: 'Beacon Ridge High School Canary Falls lockdown safety communication',
  },
  {
    id: 'demo-002', date: '2026-06-09', district_id: 'canary-falls-usd', source_type: 'facebook', source: 'Beacon Ridge High School Facebook',
    headline: 'Photos: Beacon Ridge High robotics students demonstrate solar-powered design at community showcase',
    summary: 'The school posted photos from a student showcase where robotics students presented solar-powered prototypes to local business partners and family members.',
    link: 'https://example.com/demo/robotics-showcase', canary_score: 9.2,
    tags: ['Innovation', 'Academic Success', 'Engagement'], notes: null, is_earned_media: true, is_perched: false,
    innovation_reason: '**Innovation & Technology** – Hands-on STEM learning connects classroom instruction to real-world problem solving and future career opportunities.',
    recommendation: `No immediate communications action recommended. Continue routine monitoring.`,
    source_query: 'Beacon Ridge High Bobcats Canary Falls athletics',
  },
  {
    id: 'demo-003', date: '2026-06-08', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Neighborhood Tribune',
    headline: 'Neighbors ask for more notice around Beacon Ridge High summer parking lot construction',
    summary: 'A neighborhood story noted confusion around temporary parking restrictions tied to construction on the Beacon Ridge High campus. Residents said signs appeared after work had already started.',
    link: 'https://example.com/demo/parking-construction-notice', canary_score: 3.4,
    tags: ['Operations & Finance', 'Engagement'], notes: 'Analyst note: Preventable trust-friction item; operations and comms should coordinate same-day.', is_earned_media: false, is_perched: false,
    innovation_reason: '**Community Engagement** – Highlights community expectations for proactive communication and transparency regarding district projects.',
    recommendation: `**Strategic Intent**
Protect community trust by acknowledging concerns, improving communication, and demonstrating responsiveness to neighborhood impacts.

**Audience Focus**
**Primary:** Nearby residents, families, staff.
**Secondary:** Local government, community organizations, media.

**Message Angle**
Emphasize that the district values being a good neighbor and is committed to improving communication around construction activities.

**Channel Strategy**
- Website updates, neighborhood email lists, construction FAQ page, social media updates, community meetings.

**Execution Plan**
- Coordinate with facilities staff to clarify timelines, parking changes, and anticipated disruptions. Create visual maps and regular construction updates. Designate a contact for resident concerns.

**Guardrails**
- Avoid dismissing resident concerns or assigning blame. Ensure information is accurate and updated as conditions change.

**Expected Outcome**
Reduced frustration, improved community relations, and increased confidence in district transparency.

**Next Phase**
Use lessons learned to create a standardized community notification process for future projects.`,
    source_query: '"Beacon Ridge High" "Canary Falls Unified"',
  },
  {
    id: 'demo-004', date: '2026-06-07', district_id: 'canary-falls-usd', source_type: 'instagram', source: 'Beacon Ridge High Instagram',
    headline: 'Senior spotlight series celebrates first-generation college-bound students',
    summary: 'A social series highlighted seniors who will be the first in their families to attend college, including quotes about counselors, teachers, and family support.',
    link: 'https://example.com/demo/senior-spotlight', canary_score: 9.0,
    tags: ['Academic Success', 'Engagement'], notes: null, is_earned_media: true, is_perched: false,
    innovation_reason: "**College & Career Readiness** – Showcasing first-generation students reinforces the district's commitment to expanding postsecondary opportunities for all learners.",
    recommendation: `No immediate communications action recommended. Continue routine monitoring.`,
    source_query: 'Beacon Ridge High School Canary Falls FAFSA graduation',
  },
  {
    id: 'demo-005', date: '2026-06-06', district_id: 'canary-falls-usd', source_type: 'tiktok', source: 'Canary Falls Transit Updates TikTok',
    headline: 'Morning bus detour near Beacon Avenue expected to affect Beacon Ridge High arrival traffic',
    summary: 'A public transit account announced a morning detour near campus. The post did not mention the school directly but could affect student arrival and family drop-off.',
    link: 'https://example.com/demo/bus-detour', canary_score: 5.8,
    tags: ['Operations & Finance', 'Safety & Wellness'], notes: 'Analyst note: Operational heads-up, not a reputation story; useful because it affects family logistics.', is_earned_media: false, is_perched: false,
    innovation_reason: 'N/A',
    recommendation: `**Monitor closely:** Monitor traffic and transportation-related conversations for reports of delays, congestion, or confusion affecting student arrival and dismissal. If concerns begin to surface, be prepared to share alternative routes, arrival guidance, or transportation updates to help families plan accordingly.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-006', date: '2026-06-04', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Sports Wire',
    headline: 'Beacon Ridge High track athletes qualify for state finals after standout relay performance',
    summary: 'Beacon Ridge High student athletes qualified for state finals after a season-best relay performance, with coaches praising academic eligibility and teamwork.',
    link: 'https://example.com/demo/track-state-finals', canary_score: 8.5,
    tags: ['Academic Success', 'Engagement'], notes: null, is_earned_media: true, is_perched: false,
    innovation_reason: "**Student Achievement** – Student success in athletics reflects the district's commitment to excellence and well-rounded educational experiences.",
    recommendation: `**Strategic Intent**
Celebrate athletic excellence while reinforcing the connection between academics, discipline, and student development.

**Audience Focus**
**Primary:** Families, students, alumni.
**Secondary:** Community supporters, local media, board members.

**Message Angle**
Highlight the team's commitment to both classroom and athletic success, emphasizing teamwork and perseverance.

**Channel Strategy**
- Social media, athletics website, district communications, local sports media outreach.

**Execution Plan**
- Create athlete profiles, share competition highlights, recognize coaches and support staff, and feature academic accomplishments alongside athletic success.

**Guardrails**
- Avoid focusing exclusively on winning. Ensure recognition extends beyond star performers.

**Expected Outcome**
Increased school pride, community engagement, and support for student activities.

**Next Phase**
Follow the team's state competition journey and create post-event recognition opportunities regardless of outcome.`,
    source_query: 'Beacon Ridge High Bobcats Canary Falls athletics',
  },
  {
    id: 'demo-007', date: '2026-06-02', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Civic Watch',
    headline: 'Board agenda includes security-camera upgrade request for Beacon Ridge High campus',
    summary: 'A civic agenda preview noted an upcoming vote on campus security-camera upgrades, with parent comments split between safety benefits and privacy concerns.',
    link: 'https://example.com/demo/security-camera-agenda', canary_score: 4.2,
    tags: ['Safety & Wellness', 'Operations & Finance', 'Engagement'], notes: 'Analyst note: Board-agenda item likely needs FAQ language before public comment grows.', is_earned_media: false, is_perched: false,
    innovation_reason: '**School Safety** – Proposed security enhancements support ongoing efforts to create safe and secure learning environments.',
    recommendation: `**Strategic Intent**
Build understanding and trust around a potentially sensitive decision while demonstrating thoughtful consideration of stakeholder concerns.

**Audience Focus**
**Primary:** Parents, students, staff.
**Secondary:** Community members, board members, local media.

**Message Angle**
Focus on balancing safety, privacy, transparency, and responsible stewardship of public resources.

**Channel Strategy**
- Board communication materials, FAQs, website resources, stakeholder meetings, social media information posts.

**Execution Plan**
- Develop clear talking points explaining the purpose, scope, and safeguards of the proposed upgrades. Anticipate common questions and provide fact-based responses.

**Guardrails**
- Avoid minimizing privacy concerns or framing stakeholders as opponents. Present balanced information.

**Expected Outcome**
More informed community dialogue and reduced misinformation ahead of the vote.

**Next Phase**
Monitor public feedback and adjust communications to address recurring questions.`,
    source_query: '"Beacon Ridge High" "Canary Falls Unified"',
  },
  {
    id: 'demo-008', date: '2026-05-31', district_id: 'canary-falls-usd', source_type: 'facebook', source: 'Beacon Ridge High Facebook',
    headline: 'Video recap: Beacon Ridge High culinary students prepare meals for community resource fair',
    summary: 'A district video showed culinary students preparing meals for a resource fair serving families near the Beacon Ridge High campus.',
    link: 'https://example.com/demo/culinary-resource-fair', canary_score: 8.8,
    tags: ['Academic Success', 'Engagement'], notes: null, is_earned_media: true, is_perched: false,
    innovation_reason: '**Career Pathways** – Students applied workforce-ready skills while serving the community through authentic learning experiences.',
    recommendation: `No immediate communications action recommended. Continue routine monitoring.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-009', date: '2026-05-29', district_id: 'canary-falls-usd', source_type: 'news', source: 'Valley Parent Forum',
    headline: 'Parents trade tips online after Beacon Ridge High posts summer credit-recovery schedule',
    summary: 'A parent forum thread shared questions about summer credit recovery, including how families should confirm transportation, meals, and course timing.',
    link: 'https://example.com/demo/credit-recovery-questions', canary_score: 6.2,
    tags: ['Academic Success', 'Engagement'], notes: 'Analyst note: Family questions indicate the original summer-school post needs clearer logistics.', is_earned_media: false, is_perched: false,
    innovation_reason: '**Student Success** – Access to credit-recovery opportunities supports on-time graduation and continued academic progress.',
    recommendation: `**Strategic Intent**
Identify and address information gaps before confusion affects participation and student success.

**Audience Focus**
**Primary:** Students needing credit recovery and their families.
**Secondary:** Counselors, school staff.

**Message Angle**
Position the district as responsive and committed to ensuring families have the information needed to support student success.

**Channel Strategy**
- FAQ pages, direct communications, social media, counseling outreach.

**Execution Plan**
- Create a centralized information hub covering schedules, transportation, meals, contacts, and enrollment procedures. Use common parent questions to guide content.

**Guardrails**
- Verify all operational details before publishing. Avoid assumptions about transportation availability.

**Expected Outcome**
Improved program participation and reduced family frustration.

**Next Phase**
Monitor questions throughout the summer and continuously update resources.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-010', date: '2026-05-27', district_id: 'canary-falls-usd', source_type: 'instagram', source: 'Beacon Ridge High Instagram',
    headline: 'Beacon Ridge High mariachi ensemble invited to perform at downtown arts festival',
    summary: 'The school celebrated its mariachi ensemble being invited to a downtown arts festival, highlighting student practice and cultural pride.',
    link: 'https://example.com/demo/mariachi-festival', canary_score: 9.4,
    tags: ['Engagement', 'Academic Success'], notes: 'Analyst note: Strong earned-media pitch opportunity because it is visual, cultural, and student-led.', is_earned_media: true, is_perched: false,
    innovation_reason: '**Culture & Belonging** – Celebrating student talent and cultural expression strengthens community connections and student engagement.',
    recommendation: `No immediate communications action recommended. Continue routine monitoring.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-011', date: '2026-05-24', district_id: 'canary-falls-usd', source_type: 'news', source: 'Demo Filter Log',
    headline: 'Filtered out: Beacon Ridge High in another state wins baseball championship',
    summary: 'This sample illustrates a lookalike mention that would be filtered out by geo-validation because the article is about a Beacon Ridge High in a different community.',
    link: 'https://example.com/demo/filtered-lookalike', canary_score: 1.8,
    tags: ['Operations & Finance'], notes: 'Analyst note: Demo-only row; keep it as a visible example of wrong-district validation logic.', is_earned_media: false, is_perched: false,
    innovation_reason: 'N/A',
    recommendation: `**Strategic Intent**
This result demonstrates a common monitoring problem: stories about a different school with the same or similar name. In the live Canary Data platform, geo-filtering automatically removes these false matches, helping ensure your results are accurate and actionable.`,
    source_query: 'Beacon Ridge High School wrong district examples',
  },
  {
    id: 'demo-012', date: '2026-05-22', district_id: 'canary-falls-usd', source_type: 'facebook', source: 'Beacon Ridge High PTO Facebook',
    headline: 'PTO asks families to donate water bottles ahead of excessive heat advisory',
    summary: 'The PTO posted a call for water bottle donations as temperatures rise, with comments from families asking whether outdoor practices will be adjusted.',
    link: 'https://example.com/demo/heat-water-bottles', canary_score: 5.1,
    tags: ['Safety & Wellness', 'Engagement'], notes: 'Analyst note: Practical operations item; coordinate with athletics and health/safety before families ask.', is_earned_media: false, is_perched: false,
    innovation_reason: '**Student Well-Being** – Community support efforts help ensure students have access to resources that promote health and safety.',
    recommendation: `**Monitor closely:** As temperatures rise, monitor parent questions and community comments about outdoor activities, athletics, and student safety. Be prepared to share existing heat-safety protocols, hydration practices, and any schedule adjustments if concerns or misinformation begin to increase.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-013', date: '2026-05-20', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Business Journal Demo',
    headline: 'Local tech nonprofit funds after-school coding lab at Beacon Ridge High',
    summary: 'A technology nonprofit announced support for an after-school coding lab at Beacon Ridge High, including donated equipment and mentor hours from Canary Falls employers.',
    link: 'https://example.com/demo/coding-lab', canary_score: 9.1,
    tags: ['Innovation', 'Academic Success', 'Engagement'], notes: null, is_earned_media: true, is_perched: false,
    innovation_reason: '**Community Partnerships** – External investment expands student access to technology, innovation, and future-ready learning opportunities.',
    recommendation: `**Strategic Intent**
Showcase partnership-driven innovation and expanded opportunities for student learning and career exploration.

**Audience Focus**
**Primary:** Students, families, prospective students.
**Secondary:** Employers, community partners, donors.

**Message Angle**
Emphasize collaboration between education and industry to prepare students for future careers.

**Channel Strategy**
- Press release, social media, website feature, partner communications, workforce development channels.

**Execution Plan**
- Recognize nonprofit and employer partners. Highlight student benefits, career pathways, and mentorship opportunities. Create student success stories as the program develops.

**Guardrails**
- Avoid overstating workforce outcomes before results are available.

**Expected Outcome**
Enhanced reputation for innovation, stronger partnerships, and increased student participation.

**Next Phase**
Track participation, mentor engagement, and student outcomes to support future funding and expansion efforts.`,
    source_query: '"Beacon Ridge High" "Canary Falls Unified"',
  },
  {
    id: 'demo-014', date: '2026-05-18', district_id: 'canary-falls-usd', source_type: 'tiktok', source: 'Local Reporter Demo TikTok',
    headline: 'Reporter asks for family perspectives on Beacon Ridge High grading-policy pilot',
    summary: 'A local reporter posted a request for families willing to discuss the school grading-policy pilot, signaling possible coverage before the district has framed the issue.',
    link: 'https://example.com/demo/grading-policy-reporter', canary_score: 4.8,
    tags: ['Operations & Finance', 'Engagement'], notes: 'Analyst note: Early-warning media signal; prepare context before the article is written.', is_earned_media: false, is_perched: false,
    innovation_reason: '**Continuous Improvement** – Stakeholder feedback supports data-informed decision making and evaluation of instructional practices.',
    recommendation: `**Strategic Intent**
Prepare proactively for media attention and ensure stakeholders receive accurate context before public narratives solidify.

**Audience Focus**
**Primary:** Families, staff, students.
**Secondary:** Media, board members, community stakeholders.

**Message Angle**
Position the district as transparent, thoughtful, and data-driven in evaluating educational practices.

**Channel Strategy**
- Internal communications, talking points, FAQs, website resources, media relations outreach.

**Execution Plan**
- Develop key messages, anticipated questions, stakeholder FAQs, and spokesperson preparation. Consider publishing explanatory content before media coverage appears.

**Guardrails**
- Avoid appearing defensive or attempting to influence family participation in reporting. Maintain transparency and respect differing viewpoints.

**Expected Outcome**
Improved message consistency and greater likelihood that coverage reflects district context.

**Next Phase**
Monitor media coverage and community response. Update communications based on emerging questions and concerns.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
  {
    id: 'demo-015', date: '2026-05-15', district_id: 'canary-falls-usd', source_type: 'news', source: 'Canary Falls Arts Calendar',
    headline: 'Beacon Ridge High students unveil mural honoring neighborhood history',
    summary: 'Students unveiled a campus mural created with local artists and community elders, connecting student art to neighborhood history.',
    link: 'https://example.com/demo/neighborhood-mural', canary_score: 8.9,
    tags: ['Engagement', 'Academic Success'], notes: null, is_earned_media: true, is_perched: false,
    innovation_reason: '**Community Connection** – Student learning that reflects local history strengthens civic pride and community engagement.',
    recommendation: `**Strategic Intent**
Celebrate community-connected learning while reinforcing student voice, cultural preservation, and civic pride.

**Audience Focus**
**Primary:** Families, students, neighborhood residents.
**Secondary:** Community organizations, local leaders, arts advocates.

**Message Angle**
Highlight how student creativity can preserve local stories, strengthen community ties, and create a lasting legacy on campus.

**Channel Strategy**
- Website feature story, social media campaign, local arts coverage, community events, board recognition.

**Execution Plan**
- Document the mural's creation process through photos and video. Capture reflections from students, artists, and elders. Host a community celebration and guided mural tour.

**Guardrails**
- Ensure historical and cultural narratives are represented accurately and respectfully.

**Expected Outcome**
Increased community pride, positive visibility, and stronger connections between school and neighborhood.

**Next Phase**
Develop curriculum connections, anniversary features, and additional community-based arts initiatives.`,
    source_query: '"Beacon Ridge High School" Canary Falls',
  },
];
