# Operational runbook

The ten-day pilot's registry, scoring, brief ranking and observation rules remain unchanged. Do not import demo fixtures into the runtime database. Code targets a dedicated Supabase project; the existing connected project belongs to a different application and must not receive these migrations.

## Runtime versus Codex connections

Codex can inspect Supabase/Vercel and manage Drive folders using connectors. These credentials are not exported into the application. Runtime uses server-only Supabase secret, single-editor Auth UUID, and (optionally) Google OAuth refresh credentials. Do not paste credentials into chat or commit `.env.local`.

1. Apply `supabase/migrations/*.sql`, in filename order, to the dedicated project using the connected migration tool or `supabase db push` with an authorized CLI. Browser roles have no newsroom table/RPC grants; all mutations go through authenticated server routes and domain validation.
2. In Supabase Auth create Daniel's user and set `CONTENT_OS_EDITOR_ID` to its UUID. Disable public signup in the Auth dashboard. The app has no signup endpoint and authorizes only this UUID even if other Auth users exist.
3. Set the Supabase variables in `.env.example` in Vercel **preview** environment. Set `CONTENT_OS_MODE=supabase`, `CONTENT_OS_DATA_MODE=live`. Missing hosted configuration returns 503, never an anonymous local database.
4. Run `npm run runtime:check` with runtime environment loaded. It verifies RPCs, anonymous denial and the editor identity. Run `npm run storage:setup` to create a private 10 MB bucket and verify upload/download/delete. This is repeatable, and refuses an existing public bucket.
5. Link a **new** Vercel `brainos` project, then `vercel deploy` (preview only). Never use `--prod` without approval. No preview exists until deployment succeeds; connector read access alone cannot deploy.

## Scheduling: GitHub Actions only

GitHub Actions is the selected primary scheduler because its hosted runtime and CI are already verified; no Trigger credentials are configured. `.github/workflows/newsroom.yml` runs at **06:30 America/Bogota daily**, equivalent to **11:30 UTC** (Colombia has no DST). It requires repository variable `NEWSROOM_SCHEDULER=github`, URL variable `NEXT_PUBLIC_SUPABASE_URL`, and Actions secret `SUPABASE_SECRET_KEY`. Until those runtime settings are populated, the job remains disabled. Concurrency prevents overlapping workflow runs and the database ingestion lease protects other callers. Source failures persist in the database and fail the ingestion step; the operations step still runs against successfully stored data.

GitHub recurring schedules execute on the default branch, currently `codex/automated-newsroom`, the repository's only branch. No separate main/stable branch was found. No default-branch change or merge was performed. Manual `workflow_dispatch` remains available. GitHub can delay scheduled starts; this is not a guaranteed-to-the-minute scheduler. Trigger's `morning-discovery`, ingestion and worker tasks remain manual entry points only, with **no Trigger cron registered**. No Vercel or Supabase cron is added.

Manual verification: `CONTENT_OS_MODE=supabase CONTENT_OS_DATA_MODE=live npm run ingest`, followed by `npm run operations`. Inspect `/sources` and authenticated `GET /api/operations`. Job claims use expiring leases, fenced completion, bounded attempts, delayed retries, idempotency keys and visible blocked/failed states. Worker crashes are reclaimable. No social publication happens in any worker.

## Enrichment and drafts

`enrich` records deterministic source excerpts, candidate claims, source IDs, evidence fingerprint, generator version and suggestion labels in `generation_records`. It does not mark facts verified or edit story confidence/ranking/research. The story Research tab shows the generated aid. No external LLM is called or paid for.

After human research confirmation and explicit angle approval, an `angle_ready` story without drafts is eligible for four different platform working drafts. Each remains an unapproved revision. Later editorial work is not overwritten by automation. Existing UI generation uses the same live templates rather than demo copy. No personal beliefs or experiment results are invented.

Explicit opinion memory: authenticated same-origin `POST /api/operations` with `action:"confirm_opinion"`, `storyId`, `angleId`, `topic`, `context`, `confirmed:true`, optional `supersedes`. The angle must already be approved by the authenticated editor. Ordinary angle approval **does not** create memory. Supersession adds a new row; original provenance cannot be edited/deleted. `GET /api/operations` returns current and superseded opinions.

## Media and production

Drive root created and read back through the connector:
`14h6iv1SXu7eNSrSC2WpVbXrfgZqJ6xYu` — Daniel AI Content OS.
Children: Inbox, Stories, Recordings, Assets, Exports, Published, Archive.

Runtime Drive upload requires a dedicated Google OAuth web client configured with the exact redirect URI `${CONTENT_OS_ORIGIN}/api/integrations/google/callback`. The editor opens `${CONTENT_OS_ORIGIN}/api/integrations/google/start`. The callback uses PKCE, encrypted expiring state bound to the editor, a Secure/HttpOnly/SameSite cookie, and an authenticated session. It verifies write access to the **existing** root folder before storing the refresh token with AES-256-GCM in the private `runtime_connections` table. `INTEGRATION_ENCRYPTION_KEY` is a random 32-byte runtime secret, stored separately from the database. Do not rotate it without re-encrypting existing credentials or reauthorizing.

Consent requests the Drive scope because a new OAuth app must access the pre-existing connector-created library; Google's `drive.file` scope alone does not grant that existing root. The application uses the configured root and preserves file IDs. No Gmail scope is requested, and Gmail intake stays disabled. Google OAuth app creation/consent-screen configuration requires Google Cloud authorization, which the Drive connector does not provide. No exact consent link is claimed until a hosted origin and OAuth client are configured.

Large recordings can be uploaded directly to Drive; `media_objects` retains provider file/folder IDs. The existing small-owned-media upload boundary reads the encrypted credential automatically. Uploads remain unverified until an actual authorized service round trip succeeds.

`POST /api/media` with `storyId` creates a text-only source-card SVG in private Supabase storage and records its hash/ID. It never generates a fake screenshot or clears image rights. Upload is independent from asset clearance. No third-party media downloads are added.

`GET /api/production?draft=<uuid>&draft=<uuid>` returns a batch of exact approved scripts, hook, duration, notes, shot/asset checklist and evidence references. Add `format=text` for teleprompter export. Superseded/unapproved revisions or unclear assets fail. `?publication=<uuid>` exports the validated internally scheduled handoff without calling a publisher.

The post-recording provider interface covers timestamped transcription and edit-decision proposals. Queued tasks are marked blocked until a local ffmpeg/Whisper worker exists. No transcription/rendering is falsely reported as complete.

## Publishing, newsletter, analytics, Google intake

Official publishing adapter interfaces cover X, Instagram, YouTube and newsletter providers. **No sending adapter or publish HTTP route is enabled.** Approval and rights are revalidated at handoff. `newsletter_issues` and `newsletter_sections` retain exact draft/story references; `newsletterIssue` assembles validated approved sections for review. Provider publishing requires future authorization and testing.

Analytics jobs target +24h/+72h/+7d after a recorded actual publication event, never scheduled time. Provider adapters retain raw metrics in immutable `analytics_snapshots` with unique publication/provider/window identity. Unconfigured adapters become `blocked`, not fake successful zero metrics. X/Instagram/TikTok/YouTube/newsletter interfaces exist; none currently collect live data.

Gmail connector inspection found no messages in a limited recent AI-newsletter query. The runtime read-only intake boundary is opt-in, label-scoped and disabled during the pilot. It requires separate `gmail.readonly` OAuth consent. It cannot elevate newsletter text to primary evidence or change the source registry. No emails/notifications are sent. Calendar is only a recording-block interface; no events are created.

## Cost and deployment evidence

Deterministic local operations introduce no recurring cost. No paid AI/crawling/vector service is enabled. Use existing/free service capacity; confirm any Supabase project charge before creating it. Connector inspection and folder setup do not establish runtime integration.
