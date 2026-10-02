# Content control plane

This additive slice runs beside the existing newsroom and Production Studio. It does not alter discovery feeds, ranking, scoring, deduplication or Morning Brief selection. There are no paid model calls or external sends.

## Operational surfaces

- `/workbench`: approved brand revisions, captured/qualified/selected ideas, story-linked independent content items, proposed/approved/superseded takes, exact platform packages, launch campaigns, account registry, newsletter revisions, manual metric snapshots, content experiments, public materialization and job recovery.
- `/actions`: actual pending angles/scripts/production/package/brand/take/newsletter decisions and blocked/failed jobs. The phone homepage shows the same queue.
- `/production/studio`: the existing recording, Drive intake, transcription, edit-plan, subtitles, render and exact final-production approval workflow.
- `/about`: public profile/build/content/link copies only, plus consent intake. Empty sections contain no invented work, testimonials or results.
- `/api/control/health`: authenticated database, live personal Drive, worker heartbeat, ingestion-run freshness, providers and jobs.

## First content item

1. Save and explicitly approve a brand revision. Proposed takes do not become Daniel's opinion without a separate human approval.
2. Capture an idea with provenance; qualify and select it. Competitor-derived ideas require an originality note.
3. Plan the selected idea for a platform/format. Bind its story's exact script revision and, for video, its matching Production Studio package.
4. Declare evergreen status explicitly or set a freshness deadline and record claim revalidation against retained sources. Script and angle approval stay in Story Workspace.
5. Move content through draft-ready, review and approved. Opinion content additionally requires an approved current take. Time-sensitive content cannot approve stale claims.
6. For video, finish the existing local-worker production workflow and approve its exact output/version. Short-video packages require vertical output and use a conservative 180-second limit.
7. Queue graphics, render, inspect output and explicitly document rights and platform usage scope. Clearance creates a new checksum-bearing output with creation-file lineage. Changed cover headlines require a new cover. Required unresolved rights block final approval.
8. Write platform-specific copy, create a package, approve the exact package revision, then final-approve that package for the content item. New copy is a new package; approval cannot be reused across packages.
9. Prepare a distribution job. Missing authorization or disabled provider sending produces an honest BLOCKED result. There is no external posting route.

Source research or active script changes durably invalidate downstream content approval, packages, graphics, queued work and public copies. Original files and audit snapshots remain intact. Production state in the control read model derives from the canonical Production Studio package/jobs rather than an independently edited label.

## Jobs and measurements

Graphics commit their output and successful job result atomically under the current lease. Expired leases can be reclaimed, final expired attempts enter a dead-letter state, and invalid lease tokens cannot commit output. Distribution uses an exact package/version idempotency key; public/manual publication recording is unique per package revision.

An explicitly recorded real manual publication, or an explicitly labelled demo simulation in local demo mode, schedules persistent analytics jobs at +24h, +72h and +7d. Existing daily `operations` processes due control jobs; the workbench can also process them. This is a daily control-plane tick, not an exact-hour guarantee. Unavailable providers remain BLOCKED and never fabricate metrics.

Manual snapshots retain raw observations and their human source. Performance review produces descriptive comparisons and a suggested follow-up idea. Baselines require at least five comparable publication snapshots; small-sample warnings and absence of causal inference remain explicit. Experiments store arms, assignments, metric and a human conclusion; there is no automatic optimization of Daniel's opinion.

## Public/private separation

Public components call only `read_public_surface`; they never read newsroom, claims, drafts, analytics or connections. The materialization action takes an explicitly approved source and separately approved public copy. Browser database roles can select only the public display columns and visible non-demo rows. New private tables and mutation RPCs are server-role-only. Writes require Daniel's authenticated session and a valid same-origin request. Worker calls require their existing scoped credential; protocol mismatches fail before claiming media jobs.

Newsletter intake records explicit consent, timestamp, source and privacy version. Unsubscribe uses a random capability whose hash is stored. No marketing email or beehiiv sync is active.

## Portable snapshots

`npm run backup -- backup <private-directory>` exports schema-versioned editorial, control, production, discovery/pilot/operations metadata and media references. Hosted use requires the existing private runtime environment, loaded locally; never put service keys in the worker environment.

`npm run backup:restore-local -- <snapshot.json> <new-empty-local-directory>` restores story/control/production metadata into an isolated local database and refuses a populated destination. Secrets, subscriber PII, active jobs and public visibility are intentionally not restored. This is a logical metadata recovery path, not a full Supabase physical backup. Preserve original media separately in personal Drive/private storage.

The authenticated export endpoint also downloads project JSON and content/publication/analytics/experiment/source CSV. Nested secret-bearing keys are omitted and spreadsheet formula-leading values are neutralized.

## Deliberate unfinished boundaries

- Social account OAuth/token exchange, credential installation/verification and actual send/metrics transports are **not implemented**. Current adapters validate packages and fail closed; account creation alone will not enable sending. The encrypted-credential table is a reserved private boundary, not a working connection feature.
- Instagram, TikTok, X, YouTube and beehiiv remain NOT_CREATED. No profile is created or changed externally.
- Independent ideas can be captured/planned, but script approval still requires the existing story/evidence model. A source-free standalone draft editor is not part of this slice.
- Newsletter composition/approval is operational; provider draft upload, sending, subscriber sync and double-opt-in delivery are not active.
- Graphics production exports SVGs. PNG samples in local verification evidence demonstrate rasterization; PNG is not the hosted asset API's output format.
- There is no consulting/speaking intake, automated competitor scraper, profile package factory, automatic creative edit, new cloud renderer or CRM.
- The provider transports/authorization flow are the highest-value engineering follow-up. Do not describe this candidate as a fully activated distribution system.
