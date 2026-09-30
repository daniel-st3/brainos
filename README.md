# Content OS

A working internal editorial newsroom for Daniel Rodriguez. Next.js + strict TypeScript, Supabase-compatible PostgreSQL schema, and optional Trigger.dev task boundaries. The three original reference documents are preserved unchanged in `docs/`.

## Run locally

Requires Node 22+ and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. No credentials required. The default **demo mode** runs the actual PostgreSQL migration in embedded PGlite, seeds seven fictional editorial packages, and persists edits in `.data/newsroom`. Run one app process per local data directory. This local database is for a single-process demo, not a serverless or multi-instance deployment.

For a production build locally:

```sh
npm run build
npm start
```

Demo mode intentionally has no login and contains fictional material only. Do not put real private research into an exposed demo. Use Supabase mode for a private hosted workspace. No production deployment or external publishing was performed.

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
- `/brief` — priority-story morning brief
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

`trigger.config.ts` and `src/trigger/tasks.ts` define four small future task boundaries: ingestion, enrichment, competitor monitoring, and analytics snapshots. They return an explicit `configuration_required` result and perform no collection or writes. They have no cron schedules. To activate real jobs later, configure `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY`, implement the provider adapters, and deploy tasks. These placeholders are never needed for normal app operation.

External publishing, automated ingestion, live AI, rendering, transcription, competitor scraping and analytics collection are not implemented. `scheduled_internal` is a planning record, not a send. `published_manual` means Daniel supplied a post URL; no platform API was called or independently checked.

## Checks

```sh
npm run db:validate
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Database validation applies the actual migration in a fresh in-memory PostgreSQL-compatible database, seeds it, and checks RLS. Vitest tests exercise domain invariants and real database constraints. Playwright starts the production build on port 3100 with a separate `.data/e2e` database and tests the browser workflow, HTTP shortcut rejection, and responsive routes. Use an installed Chromium via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` or `npx playwright install chromium`; this environment uses `/usr/bin/chromium`.

To reset only local demo edits, stop the app and run `npm run db:reset -- --confirm`. This deletes `.data/newsroom`, which reseeds on restart. The browser suite resets only `.data/e2e`.
