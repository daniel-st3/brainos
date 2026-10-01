# Content OS

A working internal editorial newsroom for Daniel Rodriguez. Next.js + strict TypeScript, Supabase-compatible PostgreSQL schema, and optional Trigger.dev task boundaries. The three original reference documents are preserved unchanged in `docs/`.

## Run locally

Requires Node 22+ and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. No credentials required. The default **demo mode** runs the actual PostgreSQL migration in embedded PGlite, seeds seven fictional editorial packages, and persists edits in `.data/newsroom`. Run one app process per local data directory. This embedded database supports a single local app process, not serverless or multi-instance deployment.

For a production build locally:

```sh
npm run build
npm start
```

Local storage mode intentionally has no login. Keep it on a trusted local machine; do not expose private research publicly. Use Supabase mode for a private hosted workspace. No production deployment or external publishing was performed.

## Try the workflow

1. Open Inbox and select **Can a meeting assistant earn its place in the stack?**
2. Inspect Sources, Claims, Angles, Drafts and Assets. The source fixture is fictional; the NIST link is background only and was not fetched as evidence.
3. Open Review and approve exact revision v2 after checking the confirmation box.
4. Open Production, complete the three preparation checks, and save.
5. Open Publish and schedule the approved revision internally. Times are entered in Bogotá time (UTC−05:00).
6. Edit the approved draft. A new unapproved revision is created; the prior text and approval remain in history and its internal schedule is cancelled.
7. Select an unknown-rights asset in a draft revision and try asset clearance: the server blocks it. Clear documented rights or remove it from a new draft revision.

The separate AI news fixture starts at `detected` for testing the full path: verify the claim; mark verified; save confirmed research; complete research; explicitly approve an angle; confirm angle selection; generate a draft; clear assets; choose the production branch; send to Review; approve.

The agreed story state machine places `recording_needed`/`render_ready` before `review`. Production preparation can be completed before or after editorial approval; approved packages remain visible there. Scheduling requires completed preparation. Face-led short video uses the recording branch; other copy uses the render branch. No actual recording/rendering is implemented.

## Routes

- `/` — operational command center
- `/inbox` — search, status/pillar/priority/archive filtering
- `/stories/[id]` — overview, sources, claims/evidence, research, angles, revisioned drafts, rights, activity
- `/review` — exact-revision approval, request changes, reject, return to research
- `/production` — recording and render preparation with persistent checklists
- `/publish` — approved revision queue, internal schedules, manually recorded publication URLs
- `/brief` — ranked live discoveries (or deterministic demo brief)
- `/sources` — registry, source toggles, manual fetch and ingestion run health
- `/pilot` — visible brief impressions, opens and editorial outcomes
- `/login` — authorized single-editor sign-in for Supabase mode

## Data and enforcement

`supabase/migrations/20260930220220_newsroom.sql` creates `stories`, `sources`, `claims`, `evidence`, `angles`, `drafts`, `assets`, `events`, and `publications` with indexed relationships and constraints. Draft content is immutable; edits insert a new revision. Approval metadata and history events are protected. Claims link to source excerpts, preserving original and canonical URLs and timestamps.

All UI mutations are commands handled by `src/domain/workflow.ts`; the UI cannot write a story status directly. Commands are validated with Zod. Atomic database saves use an expected story version to reject stale or concurrent writes. `save_story` uses a transaction-level lock, checks exact revision/asset eligibility, and commits the package atomically. For this small single-editor slice, the repository reads the newsroom aggregate and saves one story at a time; paginate reads when volume warrants it.

RLS is enabled on every content table. Browser roles (`anon`, `authenticated`) have no table/RPC permissions; the authenticated Next.js server uses a server-only secret key. The sole editor is authorized by exact Supabase user ID, not user-editable metadata. No enterprise RBAC. RPCs are security invoker. Avoid granting browser write access around the command service.

Approval requires a current draft, explicitly approved angle, human-confirmed research, supported linked claims and cleared selected assets. The final checkbox records human checking of exact copy/personal assertions; automatic checks do not certify factual truth or detect every invented claim in free-form edits. New or changed factual assertions must be checked by the editor. Unselected research assets do not block a text-only package. Rights changes, research changes, and new draft revisions invalidate current approvals and cancel internal schedules. Published packages are locked; future correction workflows would use a follow-up story.

AI angle approval applies to that story only. There is no permanent opinion memory or automatic belief inference. The immutable draft versions and explicit events preserve future learning material.

## Connect Supabase later

1. Create/select a Supabase project and apply the checked-in migration with the Supabase CLI or SQL editor. Do not apply this local-demo reset script to a live project.
2. Create Daniel's editor user in Supabase Auth; disable open sign-up. This app has no registration route.
3. Copy `.env.example` to `.env.local`. Set `CONTENT_OS_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `CONTENT_OS_EDITOR_ID`. For a reverse proxy, set `CONTENT_OS_ORIGIN` to the exact public origin.
4. Restart. Sign in at `/login` using the editor account's email/password. Other user IDs are rejected even with a valid login.
5. Optionally initialize a **new empty demo project** with `npm run db:seed:supabase -- --confirm`. This refuses to overwrite a nonempty newsroom. Never commit `.env.local`.

Connected Supabase auth/storage behavior requires real credentials and was not remotely exercised. The same schema, seed, reads, writes and constraints are exercised locally with PostgreSQL-compatible PGlite. No media binary storage is implemented in this slice; assets are provenance/clearance records with source and optional storage URLs.

## AI and jobs

`src/services/ai.ts` defines `researchStory`, `extractClaims`, `verifyClaims`, `suggestAngles`, `generateDraft`, and `adaptDraftForPlatform`. Deterministic mock suggestions/drafts are labeled with `deterministic-demo/v1`. No paid model credentials are used. Mock verification cannot mark claims verified automatically.

Live research uses no LLM. `src/ingestion/types.ts` includes optional `ResearchEnhancer` and `SemanticMatcher` boundaries; neither is invoked or needed. System-generated relevance and angle prompts are separate from verified factual data and approved opinions.

`src/trigger/tasks.ts` now runs the shared ingestion service. `morning-discovery` schedules 06:30 Bogotá time in a deployed production Trigger environment; `ingest-stories` supports on-demand runs. Per-source transient failures retry once; failed sources are recorded and the cycle continues. Enrichment, competitor monitoring and analytics remain disabled placeholders. Hosted workers require the same Supabase project as the app, `CONTENT_OS_MODE=supabase`, `CONTENT_OS_DATA_MODE=live`, `TRIGGER_PROJECT_REF`, and `TRIGGER_SECRET_KEY`. No Trigger deployment was performed; its SDK/configuration typecheck, but hosted execution is unverified.

External publishing, live AI generation, rendering, transcription, competitor scraping and audience analytics remain unimplemented. `scheduled_internal` is a planning record, not a send. `published_manual` records Daniel's supplied post URL.

## Live discovery

```sh
# Stop any app using the same local data directory before running the CLI.
CONTENT_OS_DATA_MODE=live npm run ingest -- --force
CONTENT_OS_DATA_MODE=live npm run dev
```

Open `/brief`, `/inbox`, `/sources`, and `/pilot`. Normal app refresh runs ingestion inside the existing process and can safely be used while reading. An isolated `.data/live-newsroom` directory persists live records; `.data/newsroom` retains the original seven-story demo. `CONTENT_OS_MODE` selects local storage (`demo`, the legacy value) versus Supabase; `CONTENT_OS_DATA_MODE` independently selects `demo` or `live`. Supabase defaults to live and never automatically seeds. Optional `CONTENT_OS_DATA_DIR` overrides the local directory. Do not run a CLI and server simultaneously against one PGlite directory. For remote persistence, apply all migrations and use Supabase mode for both jobs and app.

`npm run ingest -- --sources=openai-python,transformers --force` selects individual registered feeds, including inactive candidates for testing. Omit `--force` to send saved ETag/Last-Modified validators. Exit status is nonzero for failed sources; detailed partial results are always printed. No API keys are required. The deployment needs outbound HTTPS access to its enabled feed origins; inherited HTTP proxy settings are honored.

The maintainer-reviewed registry lives in `src/ingestion/registry.ts`: add a definition with tier, publisher, topics, URL scope and adapter. Database-backed activation and health survive runs. RSS/Atom and public GitHub Releases API adapters share one interface. Only registered origins are fetched, with redirect, response-size and timeout bounds. The four default feeds are official GitHub releases for OpenAI Python, Anthropic Python, Hugging Face Transformers and Microsoft Semantic Kernel. All four were fetched successfully here. OpenAI's newsroom feed returned a network-policy HTTP 403 here; it stays inactive. Google AI is an untested, inactive candidate. This is initial developer-release coverage, not comprehensive AI-news recall.

A run fetches each active source independently, normalizes items, keeps a 45-day lookback (publication or feed update), processes up to 50 unseen entries per source and atomically appends discoveries. New stories enter `detected`, claims remain `unverified`, and feed excerpts remain attributed publisher statements. Claims link to exact retained excerpts; original/canonical URLs, retrieval time, raw timestamp, timestamp basis, feed update time and content hash are preserved. GitHub Atom supplies update times, not original publication dates; the app never relabels them as publication dates. Public image metadata creates unknown-rights, nonpublishable candidates without downloading images.

Deduplication first uses canonical URL and explicit registered-primary links, then conservative product/entity + event + version or specific title matches within 72 hours. Tracking parameters, fragments and safe URL variants normalize; meaningful query parameters remain. Every distinct discovery is preserved. Exact repeated content is a no-op. Stronger retrieved primary evidence becomes the displayed source without deleting discovery provenance. Secondary links escalate by looking up their exact URL in a registered primary feed; no arbitrary web crawling or invented primary evidence. Missing/failed lookups are visible in run errors. Ambiguous matches remain separate. Articles with different wording and no shared URLs/entities can remain duplicates; semantic clustering is deliberately not enabled. Whole-newsroom reads are appropriate to this pilot; pagination/indexed candidate queries are the next scaling step.

A changed excerpt at an existing evidence URL keeps the previous source revision and invalidates dependent active approval/scheduling through the existing return-to-research command. Published packages remain historical records with a new evidence-review flag. Verification, opinions, exact-revision approval and asset clearance remain human decisions.

The brief selects at most ten recent/saved stories, caps unpinned items at three per publisher, and explains audience, commercial, LATAM, evidence and urgency rules. Heuristic inputs and reasons are stored at ingestion; they are not an AI truth score. No LATAM availability is inferred without explicit text (and mentions still require review). **Research next** saves a lead for investigation without skipping verification.

Visible-card impressions store `surfaced_at` (event `created_at`), brief instance and rank. Opens, saves, dismissals, research requests, first draft creation and manually missed stories are logged. `/pilot` shows outcomes without vanity analytics. Add a missed story from Brief or Inbox; it starts as an unverified link, never as fetched primary evidence. Observations are best-effort browser telemetry; editorial outcomes commit transactionally. Manual browsing is still necessary to assess recall during the ten-day pilot.

The additive migrations create `source_registry`, `ingestion_runs`, `story_discovery`, `discovery_records`, `ingestion_leases` and `pilot_events`, extend aggregate RPCs and fence ingestion writes. RLS/server-only access remains in place. No new recurring cost or paid service is introduced.

Verification on October 1, 2026: the four active feeds returned 40 entries; 27 within the lookback became detected stories and 13 older entries were skipped. Forced repeat ingestion and an in-app refresh retained exactly 27 stories, 27 source records and 27 claims; all 33 media candidates remained nonpublishable. One current release URL per publisher returned HTTP 200. Cross-publisher consolidation and escalation are covered by synthetic fixtures; the live run did not assert unrelated SDK releases were the same announcement.

## Checks

```sh
npm run db:validate
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Database validation applies the actual migration in a fresh in-memory PostgreSQL-compatible database, seeds it, and checks RLS. Vitest tests exercise domain invariants and real database constraints. Playwright starts production builds on ports 3100 and 3101 with separate `.data/e2e` demo and `.data/e2e-live` discovery-fixture databases and tests the browser workflow, HTTP shortcut rejection, and responsive routes. Use an installed Chromium via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` or `npx playwright install chromium`; this environment uses `/usr/bin/chromium`.

To reset only local demo edits, stop the app and run `npm run db:reset -- --confirm`. This deletes `.data/newsroom`, which reseeds on restart. The browser suite resets only its two E2E directories.
