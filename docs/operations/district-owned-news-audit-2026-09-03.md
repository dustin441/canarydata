# District-owned News collection audit

Date: 2026-09-03

## Question

Why does Morenci surface substantial district-published News while some districts surface little or none, and can users compare Owned and External coverage?

## Production sample

| District | Active News | Owned | External | Current Owned hosts |
|---|---:|---:|---:|---|
| Morenci Area Schools | 23 | 19 | 4 | `morencibulldogs.org` |
| Fairfax County Public Schools | 158 | 85 | 73 | `fcps.edu` and FCPS school subdomains |
| Park Hill School District | 26 | 1 | 25 | `hopewell.parkhill.k12.mo.us` |
| Shelby County School District | 105 | 6 | 99 | Six legacy TikTok URLs; zero district-newsroom URLs |
| Alabaster City Schools | 109 | 45 | 64 | Legacy Instagram/TikTok URLs; zero district-newsroom URLs |

Counts reflect the active production dataset at audit time. In the compatibility schema, `is_earned_media=false` means Owned and `true` means External; Communications-earned is a separate field.

## Findings

1. Source-ownership classification and owned-story discovery are separate concerns. The corrected classifier now reserves Owned for district-controlled properties, but it cannot classify a district release that the News provider never discovers.
2. The current News collector depends primarily on Google News/provider search. District sites are indexed inconsistently. Morenci and Fairfax currently return many official-domain pages; Park Hill returns almost none, and Shelby/Alabaster return no district-newsroom pages despite active, indexable newsrooms.
3. Several profiles contain `site:` text only as negative exclusions or in third-party outlet queries. Counting the string `site:` is therefore not evidence of an official-domain collection path.
4. Official newsroom pages are currently available and publicly indexed at:
   - `https://www.acsboe.org/news`
   - `https://www.shelbyed.k12.al.us/news`
   - `https://www.parkhill.k12.mo.us/news-and-stories`
   - `https://www.morencibulldogs.org/news`
5. Adding more Google News queries cannot guarantee owned coverage because the upstream News index is the inconsistent boundary. A reliable fix requires a bounded direct-owned-source collector for verified district newsroom feeds/pages, with canonical URL deduplication and the normal validation/finalization pipeline.

## Implemented in this release

- Added a dedicated dashboard Source Ownership filter: Owned + External, Owned only, or External only.
- Kept Source Type and Tag filters separate.
- Applied ownership filtering to the visible table, KPIs, charts, Bird’s Eye context, and report/export context.
- Updated future onboarding tasks to require an explicit official-domain newsroom coverage check and to record provider limitations truthfully.

## Deliberately not changed

- No broad production query activation or historical backfill was performed from this audit.
- No district newsroom was represented as complete merely because its public archive exists.
- No raw Social posts were newly merged into News.

## Recommended next build

Design a bounded direct-owned-news collector, starting with one pilot district. It should discover article URLs from a verified district newsroom index/feed, normalize and deduplicate URLs, apply the current source-ownership and interpretation guards, enforce the approved owned-data window, and reconcile results against the public newsroom before expanding.
