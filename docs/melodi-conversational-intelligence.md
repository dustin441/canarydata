# MELODI conversational intelligence

## Product role

MELODI is Canary Data's district-scoped AI chat. It lets authenticated communicators ask questions about the news, public-social intelligence, and approved strategic profile already available in Canary.

MELODI is not a generic replacement label for Canary recommendations. Canary remains the product and evidence system. MELODI is the conversational interface for interrogating that evidence.

## Initial questions

- What should I pay attention to today?
- Which stories align with our strategic priorities?
- What public social conversations may need review?
- Summarize our top social posts from the last 30 days.
- Prepare a concise leadership summary from the available evidence.

## Grounding and tenancy

- The server verifies the Supabase session and reads protected user metadata before querying data.
- Non-admin users are locked to their assigned district.
- Admin users must select one district before asking a question.
- Every database query includes the resolved district ID.
- Client users receive only active records. Admin reviewers may include review-status public-social records, which remain clearly labeled.
- Notes, credentials, billing data, client lists, and cross-district data are never included in model context.

## Evidence and safety

- MELODI receives a bounded set of relevant news and public-social records plus active strategic priorities.
- News, social, and strategic records receive stable record-derived citation IDs such as `N-6F0BB1DAD8CA`.
- Answers are rejected unless substantive paragraphs use known citations; one bounded rewrite is allowed before the route fails closed.
- The UI links validated citations back to safe HTTP or HTTPS source URLs.
- Source content is treated as untrusted data rather than model instructions.
- If the available records do not answer a question, MELODI should state what is missing.
- Public-social discovery is explicitly described as incomplete and not equivalent to native platform notifications or inboxes.
- MELODI cannot publish, reply, assign, approve, or complete actions.

## Cost and abuse boundaries

- Default model: `openai/gpt-5-mini` through Vercel AI Gateway.
- Production uses Vercel OIDC, so no provider key is exposed to the browser or stored in application source.
- Context is capped at 18 news records, 12 public-social records, 20 active priorities, and four prior user questions. Client-supplied assistant turns are not trusted or replayed.
- Answers are capped at 800 output tokens and instructed to stay under 450 words.
- An authenticated user receives at most eight requests per ten-minute database window.
- The atomic Supabase function `canary_check_melodi_rate_limit` persists limits across serverless instances, cold starts, and deployments. The route fails closed if this cost control is unavailable.
- Request bodies are stream-read and rejected as soon as they exceed 25 KB, including chunked requests without `Content-Length`.

## Current limitations

- Customer visibility and model requests are gated by `MELODI_ENABLED=true`; keep the gate off until AI Gateway billing is active, `supabase/melodi_usage.sql` has been applied, and authenticated production QA passes.
- Chats are session-local and are not yet persisted.
- Retrieval is deterministic lexical ranking with special handling for 30-day and top-social questions. It is not vector search.
- MELODI does not search the live web.
- The initial release does not write actions into the future Unified Review Queue.
- Model answers require human verification before operational or leadership use.
