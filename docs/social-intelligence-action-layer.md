# Canary Social Intelligence Action Layer

## Goal

Turn public social collection into a district-specific communications workspace that answers four questions:

1. Where is the district showing up?
2. Is the item district-published, explicitly tagged or mentioned, or a broader public conversation?
3. Does the item require a response, amplification, monitoring, escalation, or incorporation into the communications plan?
4. Which approved mission, vision, value, or strategic priority supports the recommended action?

This layer remains review-only. It must not publish replies automatically.

## Validated Alabaster foundation

- Official district posts are stored as `relationship_type=owned`.
- Structured Instagram tags are stored as `relationship_type=direct_tag` only when provider metadata proves the tag.
- Public Facebook search matches are stored as `relationship_type=ambient` unless explicit provider metadata proves a tag or mention.
- Representative public comments are linked to their parent `social_threads` records.
- All Apify records remain `visibility_status=review`.
- Public discovery is isolated from `news_stories` and from the official-account collection workflow.
- Alabaster has a high-confidence strategic profile with current mission, vision, values, and five active strategic priorities.

## Navigation model

Use three coordinated controls rather than one long mixed feed.

### Channel

- All
- Facebook
- Instagram
- TikTok
- Future supported channels

### Relationship

- District posts
- Tagged or mentioned
- Public conversations

### Action queue

- Needs response
- Amplify or reshare
- Use in communications strategy
- Monitor
- Escalate
- No action

Each control should update one shared result set and preserve the other selected dimensions. Counts should appear on every option.

## Action taxonomy

### Respond

Use when a public question, incorrect claim, service issue, safety concern, or direct request reasonably requires acknowledgement or an answer.

Output:

- Why a response is recommended
- Urgency
- Suggested owner
- Draft response
- Facts that require verification
- Relevant strategic alignment

### Amplify

Use when a partner, family, employee, student, local organization, or news outlet shares credible content that advances the district's story.

Output:

- Recommended engagement: like, thank, reshare, quote, or feature
- Suggested caption or acknowledgement
- Channel recommendation
- Relevant strategic alignment

### Use in communications strategy

Use when a post or comment reveals a repeatable theme, stakeholder need, proof point, content opportunity, or perception gap.

Output:

- Strategic insight
- Audience
- Suggested content format
- Suggested campaign or calendar use
- Relevant mission, value, or priority

### Monitor

Use when the item is relevant but does not warrant immediate engagement.

Output:

- Reason to monitor
- Trigger that would change the recommendation
- Suggested review window

### Escalate

Use for credible safety, legal, personnel, privacy, misinformation, or high-risk reputation issues.

Output:

- Risk category
- Urgency
- Internal owner
- Facts to preserve
- Draft holding language only when appropriate

### No action

Use when the item is relevant enough to retain but provides no meaningful communications opportunity or risk.

## Grounded enrichment contract

Every enriched social record should receive a structured review payload:

```json
{
  "action_type": "respond|amplify|strategy|monitor|escalate|none",
  "urgency": "now|today|this_week|routine",
  "audiences": ["families", "staff", "students", "community", "media"],
  "situation_summary": "Short factual summary",
  "action_rationale": "Why this action fits the evidence",
  "draft_response": "Optional review-only draft",
  "content_opportunity": "Optional campaign or calendar use",
  "strategic_priority_ids": ["verified active priority UUIDs"],
  "strategic_alignment_reason": "How the item and action connect to the priority",
  "mission_or_value_evidence": ["Exact approved profile language used"],
  "facts_to_verify": ["Any unsupported or changing facts"],
  "confidence": 0.0,
  "generated_at": "ISO timestamp",
  "model_version": "versioned classifier and prompt"
}
```

Rules:

- Only active strategic priorities may be assigned.
- Mission, vision, and value language must come from the district's approved `strategic_profiles` record.
- Drafts must not invent district policy, dates, names, commitments, or operational facts.
- Low-confidence classifications stay in review and display why confidence is low.
- A person must approve any response or publishing action.
- The product should show the evidence used for each recommendation.

## Alabaster examples

- YMCA camp posts tagging the district: `amplify`; thank the partner and consider resharing; align to engaged stakeholders, adaptable learning experiences, and whole-child support.
- Local business classroom-preparation tag: `monitor` or `amplify` depending district endorsement policy; possible staff-appreciation content; verify vendor relationship before resharing.
- Alabaster Health Fair post: `amplify`; include in family and community calendar; align to comprehensive student support and community partnership values.
- Former Thompson athletes hosting a youth camp: `amplify` or `strategy`; recognize alumni and community involvement; align to whole-child opportunities and engaged stakeholders.
- Public LSU athlete discussion referencing Thompson: `monitor`; potential alumni-success proof point after verification; no direct response required.
- Generic local sports commentary: `monitor` or `none`; relevant awareness, but no action unless engagement or sentiment changes.

## Workflow design

Create a separate enrichment workflow after collection and deduplication:

1. Read review social threads that have no current enrichment version.
2. Load the district's approved strategic profile and active priorities.
3. Load the parent post plus representative comments.
4. Classify relationship, action type, urgency, audience, and risk.
5. Generate a grounded action recommendation and optional draft.
6. Validate priority IDs against active database rows.
7. Reject unsupported drafts or unknown facts.
8. Write the structured enrichment payload in review status.
9. Record model, prompt, source IDs, confidence, and run health.
10. Present it in an Action Queue without posting externally.

## Dashboard presentation

Each social scorecard should add:

- Relationship badge
- Action badge
- Urgency badge when relevant
- `Aligned with` priority chips
- One-sentence recommended action
- `Why this aligns` explanation
- Optional `Review draft response` drawer
- `Add to communications plan` action
- `Mark monitor`, `No action`, or `Escalate` review controls

Add an Action Queue view with columns or tabs for Respond, Amplify, Strategy, Monitor, and Escalate. Keep the existing post scorecard as the evidence view.

## 80-buyer operating model

Store a per-district discovery configuration containing:

- Official handles and profile URLs
- Exact district name and approved abbreviations
- School names
- Superintendent and spokesperson names when approved
- High-precision hashtags
- Geographic anchors
- Lookalike and commercial-noise exclusions
- Collection cadence and caps

Initial limits per district:

- Instagram structured tags daily
- Facebook public search weekly until reliability and value are measured
- Maximum three high-precision Facebook queries per scheduled run
- Maximum 10 candidate posts per comment-expansion run
- Maximum 100 comments per weekly run
- Candidate-driven comments only
- Review-only ingestion
- Separate source-health records for Instagram, Facebook search, and comments
- Partial status whenever one provider lane returns an unexplained zero or structured error

Track per district:

- Actor starts and actual cost
- Raw candidates
- Accepted results
- False-positive rate
- Duplicate rate
- Tagged and mentioned volume
- Actionable-result rate
- Provider-empty and provider-error rate
- Human overrides of action and alignment

Scale cadence only after each district demonstrates enough actionable volume to justify it.

## Recommended delivery sequence

1. Navigation and relationship clarity.
2. Alabaster enrichment pilot across the seven current discovery records.
3. Human review of action types and strategic alignment.
4. Action Queue and draft-response drawer.
5. Recurring review-only enrichment workflow.
6. Per-district configuration and cost controls for buyer rollout.
7. Cross-district QA before expanding beyond the pilot cohort.
