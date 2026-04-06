@AGENTS.md

# Canary — Media Intelligence Platform

## What this is
Canary is a SaaS media monitoring tool targeting public sector organizations (schools, governments). It tracks news and social media coverage, scores sentiment, and surfaces actionable insights. Positioning: "slimmed-down enterprise" — cheaper and simpler than incumbents like TVEyes ($1.5–1.9k/mo).

**Co-founders:** Dustin Trout (builds) + Lesley (pitches, client-facing)  
**Live URL:** https://canarydata.vercel.app  
**GitHub:** https://github.com/dustin441/canarydata  
**Supabase project:** fehdonfrlsrrkzaemkxp  

## Stack
- **Next.js 16.2.2** + **React 19** (App Router)
- **Supabase** (`@supabase/ssr`) — auth + database
- **Recharts 3** — charts
- **Plus Jakarta Sans** — font (loaded via Google Fonts in globals.css)
- Deployed on **Vercel** (auto-deploys on push to `main`)

## Key files
```
src/
  app/
    page.js                  # Marketing homepage (hero, differentiator, features, pricing)
    page.module.css          # Homepage-only scoped styles (dark-mode, glassmorphism, animations)
    layout.js                # Root layout, loads fonts
    globals.css              # Full design system — use these classes, don't add inline styles unless necessary
    actions.js               # Server actions: setEarnedMedia, saveNote, addQuery, deleteQuery
    dashboard/
      page.js                # Server component — fetches articles + districts + queries, resolves user district
      DashboardClient.js     # Client component — all views: dashboard, notes, queries, settings
    login/
      page.js                # Supabase auth sign-in form
    signup/
      page.js                # Supabase auth sign-up form (email confirmation flow)
    auth/callback/
      route.js               # Exchanges Supabase email confirmation code for session, redirects to /dashboard
  lib/
    data.js                  # Server-side data fetching via admin client (getArticles, getDistricts, getQueries)
    supabase/
      admin.js               # Service-role client — bypasses RLS, server-side only
      client.js              # Browser client
      server.js              # Server client (anon key + cookies)
      middleware.js          # Session refresh
  middleware.js              # Auth guard — redirects unauthenticated users to /login (/ is public)
```

## Database schema (Supabase)
**`news_stories`** (220+ rows) — main articles table
- `id` uuid, `date`, `headline`, `summary`, `link`, `source`, `source_type` (news/facebook/instagram/tiktok/etc.)
- `sentiment` numeric, `canary_score` computed `((sentiment+1)*4.5)+1`
- `tags` jsonb array e.g. `["Innovation", "STEM"]`
- `notes` text, `is_earned_media` boolean, `is_perched` boolean, `innovation_flag` boolean
- `innovation_reason` text, `recommendation` text
- `district_id` text (foreign key to districts.id)

**`districts`** (2 rows) — `id` text, `name`, `city`, `state`, `zip`
- `bessemer-city-schools` — Bessemer City Schools, AL
- `santa-clara-usd` — Santa Clara Unified School District, CA

**`search_queries`** (25 rows) — monitored search terms per district  
**`social_sources`** (6 rows) — social accounts being tracked

**RLS:** Enabled on all tables but NO policies defined. Always use the admin client (`createAdminClient()`) for data access — the anon client returns zero rows.

## Auth users
| Email | District | Role |
|-------|----------|------|
| dustin@eic.agency | (all) | Admin — sees all districts |
| lesley@schoolspiritpr.com | bessemer-city-schools | Client |
| jdericco@scusd.net | santa-clara-usd | Client |

District restriction works by reading `user_metadata.district_id` via the admin client on dashboard load. Users with a `district_id` only see their district's data; the district switcher is hidden from them.

## Design system
All component classes are in `globals.css`. Key ones:
- Layout: `.dashboard-layout`, `.sidebar`, `.main-content`, `.topbar`, `.page-content`
- Cards: `.kpi-card`, `.kpi-grid`, `.chart-card`, `.charts-grid`
- Table: `.data-section`, `.data-header`, `.data-filters`, `.data-table`, `.filter-input`, `.filter-select`
- Badges: `.score-badge.high/medium/low`, `.note-indicator.has-note`
- Modals: `.modal-overlay`, `.modal`, `.modal-actions`
- Forms: `.form-input`, `.form-textarea`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-sm`, `.btn-danger`
- Auth: `.auth-page`, `.auth-card`, `.auth-logo`
- Brand colors: `--canary-yellow: #F5C518`, `--bg-primary: #0B1120` (dark theme)

## Views (all rendered inside DashboardClient via `currentView` state)

**Dashboard** (default)
- KPI cards: total mentions, avg canary score, top source, notes count
- 4 charts: mention trend (area), source breakdown (donut), sentiment trend (line), health score gauge
- Article table with: search, source filter, tag filter, district filter (admin only)
- **Column manager** (⊞ Columns button) — toggle any column on/off, saved to localStorage
  - Available columns: Date*, Headline*, Summary, Link, Source, Tags, Score, Innovation Reason, Recommendation, Earned Media, Notes (* = required)
- **Earned Media checkbox** — saves to DB instantly via server action with optimistic UI
- **Notes** — add/edit/clear via modal form, saves to DB via server action

**Queries** — list all monitored search terms grouped by keyword vs geographic; add new queries; delete queries; filtered by district (admin only)

**Notes** — table of all articles that have analyst notes, with Edit button to open the note modal

**Settings** — notification preferences (UI only, not wired) + Sign Out button (functional)

**Sidebar**
- District switcher (admin only) — filters all views including charts
- Mobile hamburger menu support

## How to run locally
```bash
# node is managed via nvm — use the full path if `node` isn't in PATH
~/.nvm/versions/node/v24.14.1/bin/node node_modules/.bin/next dev
# App at http://localhost:3000
```
Requires `.env.local` with:
```
NEXT_PUBLIC_SUPABASE_URL=https://fehdonfrlsrrkzaemkxp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key>
SUPABASE_SERVICE_ROLE_KEY=<secret key>
```

## Planned / next features
- Perch feature: pin topics to dashboard for continuous monitoring
- Dynamic tagging (replace static tags with user-customizable system)
- AI chatbot for tag guidance and Q&A on the article database
- Email digest / newsletter format report
- Data sourcing improvements (current gap: some stories missed due to Apify free-tier limits)
- Source consolidation (merge duplicate sources e.g. WVTM + WVTM13.com)
