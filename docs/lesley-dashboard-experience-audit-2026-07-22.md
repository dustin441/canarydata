# Lesley-perspective Canary dashboard audit

**Date:** 2026-07-22  
**Evidence window:** 2026-01-23 through 2026-07-17  
**Source set:** 16 Fathom calls involving Lesley Bruinton, plus authenticated production QA of Alabaster City Schools

## Executive assessment

Canary is on point at the product-strategy level. The clearest call-backed model is:

**media → meaning → local decision → leadership proof**

The current product already handles media presentation, Strategic Alignment, Bird’s Eye View, review-only recommendations, and public-social action filtering well. The largest UX problem was that those strengths were split across pages and placed too far below the first decision point. A communicator could see metrics and media before seeing what mattered or what to do.

This release closes part of that gap with a dashboard Communications Brief, district-scoped counts, compact social decision cues, truthful freshness, and a working task-based How This Works page. The remaining opportunity is a unified decision workflow across news and social, with ownership, disposition, follow-up, and export.

## Evidence from Lesley

### 1. Data integrity comes before feature value

Lesley consistently treats completeness, reconciliation, and understandable metrics as prerequisites to trust.

- 2026-03-27: “First is the data integrity piece… Are you able to navigate through it, sift through it, add notes as you want?”  
  `https://fathom.video/share/ZvmjscwBEqifkxDe3y1MTAKFGi-Uexoj?timestamp=2177`
- 2026-05-15: “Sad doesn’t necessarily equal bad.” She then reframed sentiment around whether the coverage is harmful to the organization.  
  `https://fathom.video/share/ZerbzrHKv2VzEzsi8sm4EW6_7Uu-wSoJ?tab=summary&timestamp=1080`  
  `https://fathom.video/share/ZerbzrHKv2VzEzsi8sm4EW6_7Uu-wSoJ?tab=summary&timestamp=1192`

**Product requirement:** visible counts must reconcile with the selected district and filters; freshness and source limits must be explicit; recommendation confidence must not be confused with certainty.

### 2. Social recommendations should be short unless risk demands detail

- 2026-06-05: “Every social media post has a very long recommendation… I think it should be easy.”  
  `https://fathom.video/share/c2VTpykXyKPNKfyk_Csx8jzZQ93Gd6Mp?tab=summary&timestamp=543`
- 2026-06-19: “The news ones would have long responses… social medias would have short responses, unless they were bad.”  
  `https://fathom.video/share/CH1vwoyfxysb2ZHxsyP8Cz5BZcXU2LNY?tab=summary&timestamp=432`

**Product requirement:** show a concise decision cue first, then let the reviewer expand evidence, verification facts, strategic grounding, comments, and draft language.

### 3. Recommendations must support local judgment, not dictate action

- 2026-06-26: “It should be generic in that or broad, high level so that you can have local determination of what the right next steps are. Like we shouldn’t be in a position of telling you what to do.”  
  `https://fathom.video/share/WUEi4kUgN1c_vSpHbD4fzgQBY9hjtb_N?tab=summary&timestamp=1155`

**Product requirement:** recommendations remain advisory, review-only, evidence-backed, and explicit about facts that need verification.

### 4. Bird’s Eye View is the leadership product

- 2026-07-10: Lesley said she “love[s]” Bird’s Eye View and specifically values Strategic Hits.  
  `https://fathom.video/share/czeCimHhV_KqVsYr4HnE9gWfyoQ7mMCQ?tab=summary&timestamp=697`
- 2026-07-17: Bird’s Eye View was confirmed as the most valuable feature for superintendent, board, and leadership reporting.  
  `https://fathom.video/share/vhZZPAXxGWim4649GKYwwJZKaLv8M8wR?tab=summary&timestamp=64`

**Product requirement:** keep Bird’s Eye View deliberately distilled and separate from the communicator’s working dashboard. Show strategic contribution, not just activity.

### 5. Counts, percentages, and exports prove communications value

- 2026-04-24: “Turn the Meltwater report into an interactive dashboard or a PDF for the client to review.”  
  `https://fathom.video/share/EGDEjTDQDfy5z-y3bC4X5RWj9n2V5t3j?tab=summary&timestamp=543`
- 2026-07-10: Earned media needs a hard count and a percentage so a communicator can show proactive contribution.  
  `https://fathom.video/share/czeCimHhV_KqVsYr4HnE9gWfyoQ7mMCQ?tab=summary&timestamp=723`

**Product requirement:** every leadership metric should be explainable, filterable by reporting period, and exportable with its supporting evidence.

### 6. The communicator needs a working view, not only an executive report

Lesley’s feedback distinguishes two experiences:

- **Communicator:** media, context, recommendations, notes, verification, and next actions.
- **Leadership:** concise Strategic Alignment evidence, counts, percentages, and exports.

The dashboard should therefore prioritize decision support, while Bird’s Eye View should remain a clean proof artifact.

## Production observations before this release

Authenticated QA used Alabaster City Schools in production.

### Strengths

1. **Bird’s Eye View is strategically correct.** It is clearly labeled for superintendent, cabinet, board, accreditation, and evaluation use. It has date filters, Strategic Hits, Earned Media, supporting stories, CSV, and PDF.
2. **The Social Action Queue matches Lesley’s local-decision model.** Respond, Amplify, Strategy, Monitor, and Elevate are review-only and can be combined with channel and relationship filters.
3. **Social records are unusually transparent.** Cards show the original media or an honest fallback, public metrics, representative comments, why Canary found the record, evidence confidence, strategic grounding, facts to verify, and original-source links.
4. **The public-data boundary is visible.** The interface does not claim access to private profiles, direct messages, or closed groups.

### Gaps found

1. **Selected-district counts did not reconcile.** Alabaster’s dashboard showed 64 media mentions and Social showed 398 results, while the sidebar showed 2,523 Articles and 45 Social. The sidebar was mixing global and legacy counts with a district-scoped experience.
2. **“What to do” was buried on the main dashboard.** Recommendations existed in a wide article table below KPI cards and charts. They were not a first-screen decision aid.
3. **Social action was below the fold inside large cards.** On text-only posts, a large decorative media fallback consumed vertical space before the recommended next step appeared.
4. **How This Works was not operationally useful.** Its Google Drive video returned HTTP 403 in authenticated production QA, and the page emphasized an early-adopter price instead of the actual customer workflow.
5. **Freshness was implicit.** The main dashboard did not clearly state the newest media date, making stale or delayed collection harder to notice.
6. **The action workflow is still fragmented.** News recommendations and social action cues live in different interfaces, and neither currently has owner, status, due date, disposition, or follow-up history.

## Optimizations implemented in this release

1. **District-scoped navigation counts**
   - Articles, Social, Queries, Notes, and corrections now follow the selected district.
   - Social uses the same normalized and deduplicated result model as the Social page.
   - Dashboard note totals follow the currently filtered media set.

2. **Dashboard Communications Brief**
   - Adds “Here is what matters and what to do” directly below the KPI cards.
   - Shows newest media mention, recommended next-step count, social action-cue count, and Strategic Hits.
   - Surfaces up to three current non-routine media recommendations.
   - Links directly to the Social Action Queue.
   - All values respect the active district and media filters.

3. **Social decision cues above media**
   - Enriched cards now show action, urgency, concise next step, and review-only status before the creative area.
   - Full evidence and draft detail remain available below.
   - Text-only media fallbacks are compact, reducing wasted space without pretending media exists.

4. **Task-based How This Works page**
   - Removes the broken private Drive embed and in-product pricing block.
   - Replaces them with the actual workflow: see media, decide what matters, choose the next step, and show the value.
   - Preserves the public-coverage boundary and human-approval requirement.

## Remaining priorities

### Priority 1: Unified Review Queue

Combine news recommendations and social action cues into one review workspace while retaining source-specific detail.

Minimum fields:

- Action type
- Importance or urgency
- Owner
- Due date
- Review state
- Accepted, edited, reassigned, dismissed, or completed disposition
- Facts to verify
- Supporting source links
- Follow-up note

This is the strongest next step because it turns good recommendations into a measurable communications workflow without automating external responses.

### Priority 2: Collection freshness and source health

Add a compact status surface that shows:

- Last successful news collection
- Last successful official-social collection
- Last successful public-discovery collection
- Partial-provider warnings
- Newest stored item by source
- Coverage limitations

This should be visible without exposing operational credentials or implementation details.

### Priority 3: Leadership-ready action export

Bird’s Eye View already proves Strategic Alignment. Add an optional concise action appendix containing only approved or completed recommendations, not every draft suggestion.

### Priority 4: Daily communicator digest

Deliver a digest with:

- New media since the previous digest
- Top items requiring review
- Strategic opportunities
- Changes in important threads
- Direct links into the relevant filtered queue

The digest should be a doorway into Canary, not a replacement for source verification.

### Priority 5: Strategic-plan provenance and versioning

Store and show the approved plan version, source, approval date, and school-year applicability. This reduces false alignment and makes leadership evidence more defensible.

## Bottom line

Canary is on point in product direction, especially Bird’s Eye View, review-only strategic recommendations, and the new Social Action Queue. The experience becomes materially more valuable when it stops behaving like separate analytics pages and starts behaving like one guided communications workflow.

The immediate release improves the first decision path. The next major investment should be a unified Review Queue with disposition tracking, followed by visible collection health and a daily digest.
