# Cloud publication approval spine

This is an execution boundary for **already prepared and cleared final packages**, not a creative engine or an autonomous editorial author. No creative grammar was added. Existing upstream research/angle/script/production/package approvals remain authoritative. The system cannot honestly promise one human decision for the entire discovery-to-original-video path today.

## Existing infrastructure reused

- Supabase private control entities and append-only control events, epoch compare-and-swap; existing editor auth + same-origin POST checks.
- Existing immutable provider outbox, leased dispatcher, final revision/rights/freshness checks, adapter selection, receipts and 24/72/168-hour analytics jobs.
- Private `brainos-production` storage; checked provider delivery URLs minted only at dispatch. Review URLs are authenticated and expire after five minutes, are not persisted in candidates, and are never public page content.
- Existing Trigger.dev SDK **4.6.4** and task directory. Existing discovery/operations scheduling is unchanged.
- In-app notification records and the review queue. No external notification service was configured as of 2026-10-03.

## Smallest added flow

`prepare-publication-review` (trusted cloud task, package ID + optional exact schedule)
→ validate existing approvals/account/media
→ immutable `review` control record (`cloud_approval_v1`) + deduplicated notification
→ `publication-approval`
→ `wait.createToken` / `wait.forToken` (30-day deadline; yields compute)
→ authenticated `/review/<candidate ID>`
→ atomic database decision + exact content final approval
→ complete wait token / idempotent resume task
→ optionally `wait.until` requested schedule
→ revalidate candidate
→ existing outbox + adapter + publication receipt + analytics.

The token payload is **never approval authority**. The task reloads the server-recorded decision; a forged/completed token cannot publish. Wait token secrets/public callback URLs are never sent to the review client. API decision retries are safe; another decision cannot overwrite the first.

Frozen data includes full caption/thread/title, destination account/adapter, story/draft/package/creative bindings, original media identity/checksum/order and requested timestamp. A database trigger forbids rewriting this snapshot and recorded decision. Dispatch checks the candidate again in addition to existing outbox invariants. Refreshes of provider credentials do not change destination identity.

- `APPROVE`: exact final approval, then resume. An expired schedule needs a fresh candidate.
- `REQUEST_CHANGES`: terminal for this candidate; immutable feedback and a link/notification to the existing story draft workspace. New revision → new candidate → fresh approval.
- `REJECT`: terminal, audited, no enqueue.
- Expired/stale candidates cannot be approved. No automatic approval on timeout.

One candidate has one destination/platform package. Multi-platform publication uses separately reviewable exact platform candidates; there is no implicit cross-platform authorization.

## Mobile review

`/review` is the queue; `/review/<id>` shows complete ordered media, playable video, exact caption/thread, destination, timing, sources and checksums. Existing single-editor authentication applies. All mutations require same-origin requests. Approval remains disabled for live candidates until the cloud runtime is configured. Demo candidates are clearly labeled and can only use the simulator.

## Unattended dependency audit

| Step | Current execution | Limitation |
|---|---|---|
| Discovery, retained-source enrichment, operations | Existing hosted scheduler + Supabase/Vercel | Pilot and ranking unchanged |
| Original editorial preparation | Deterministic existing operations + human approvals | No new unattended creative generator; no invented Daniel take |
| Existing SVG → PNG/JPEG | Node/Sharp, Supabase storage in hosted mode | Existing rendering only, no new style |
| Recording, Whisper, FFmpeg renders | Mac worker today | **Cloud rendering/transcription not provisioned**; pre-uploaded final cloud media can proceed |
| Immutable review/decision | Supabase + Vercel | Works without Mac |
| Durable task wait/resume | Trigger.dev task implemented | **Project/key/deployment missing from inspected local/Vercel config** |
| Phone notification | In-app record/queue | **External push/email transport absent**. Opening BrainOS is currently required |
| Publish/receipts/analytics | Existing hosted outbox/operations | Provider capability limits continue to apply |

Optional local workers are not imported by the new runtime. Tasks reject local persistence and require `CONTENT_OS_MODE=supabase`.

## Runtime activation (no credentials invented)

Use an existing Trigger project, with its **staging** environment. Securely configure `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY` in the preview control plane. Trigger worker needs the existing Supabase URL/server secret, BrainOS integration encryption key, provider configuration/origin and appropriate publishing emergency-stop setting; never expose server credentials to clients. Deploy tasks using the matching Trigger CLI and verify SDK compatibility/current CLI help. Do not point staging at production runtime keys.

No production cadence is attached. `staging-approval-schedule` accepts only a demo package in Trigger's staging environment, with schedule `externalId` set to that demo package UUID. It creates a simulator-only candidate and pauses. Attach a temporary schedule, observe the run, then remove it. No real provider call is allowed by the demo candidate guard.

`approval-recovery` is a reusable unattached scheduled task that redelivers pending wake events for already-persisted candidates/decisions. Configure an operational recovery schedule when activating Trigger; this is not a new content-production cadence. Failed runs can also be replayed safely. Already queued outbox rows are reconciled by existing hosted operations.

**Notification blocker:** smallest option is an already-owned transactional email or push transport sending only “DVNI post ready for review” + authenticated link. No media, secrets or approval tokens in messages. None was found; no new account, email send or paid notification vendor was introduced. Mobile web push would additionally require device permission/subscription and server VAPID keys; that is not secretly enabled here.

## Provider findings (official docs checked 2026-10-03)

BrainOS's Buffer adapter already supports image posts/carousels, a single video, text/threads where the connected network permits, and explicit automatic publishing, with normalized failures, retries, receipts and cancellation boundaries. Notification-only channel modes do **not** meet the single-decision unattended requirement.

The [Buffer GraphQL reference](https://developers.buffer.com/reference.html) exposes ordered `assets`, and the [media hosting guide](https://developers.buffer.com/guides/hosting-media.html) requires provider-fetchable hosted URLs. This does not prove every media combination is accepted for every channel.

Buffer's current official help pages conflict: [Using Instagram](https://support.buffer.com/en-us/articles/using-instagram-with-buffer-YSjg2dXFV8) advertises mixed-media carousels, whereas [Scheduling Instagram](https://support.buffer.com/en-us/articles/scheduling-instagram-posts-reels-stories-and-notifications-3XA98S9Q5p) says mixed media is unsupported. Consequently **mixed image/video Buffer publishing remains unverified and blocked in BrainOS**; no live test or speculative adapter rewrite was made. The first production test should use an already-supported image carousel or one video. This evidence does not establish that direct Meta is required. Existing direct-provider architecture is preserved.

YouTube's private-only audit limit and beehiiv's Posts plan limit remain blockers to their corresponding public sends. X recovery remains untouched.

## Verification boundary

Unit/integration tests exercise the real database/control/outbox with simulated provider, immutability, stale approval, retries, schedule, changes/rejection and analytics receipts. Trigger task tests inject the SDK wait boundary and prove database-authoritative resume; these are **not evidence of a deployed Trigger checkpoint**. Browser tests cover authenticated-route behavior in the demo fixture runtime, media and 390px decisions. A deployed Supabase/Vercel simulator test can verify hosted storage/review/receipts without claiming it proves Trigger cloud execution.

Official Trigger references: [wait tokens](https://trigger.dev/docs/wait-for-token), [schedules](https://trigger.dev/docs/tasks/scheduled). Real cloud pause/resume proof remains required after project credentials are installed. No real content production cadence or live publication is activated by this pass.
