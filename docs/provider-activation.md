# Provider activation and safe operations

The preview is the control plane. External writes and subscriber synchronization are disabled by default. BrainOS V1 uses Buffer’s official API for Instagram, TikTok, and X where the selected channel permits automatic publishing. Creating an account or connecting Buffer does not enable external writes. YouTube and beehiiv retain their direct/native paths.

Use `/activation` to record account creation, handle availability, 2FA/recovery checklist, editable profile revisions, connection/capabilities and profile drift. `/operations-center` exposes timers, worker health, failed jobs, safe recovery and notification acknowledgement. `/recording-demo` is a read-only presentation of fictional fixtures, never live outcomes.

## Buffer: the V1 path for Instagram, TikTok, and X

Daniel creates the social accounts and connects the intended channels in Buffer. Buffer manages social authorization; BrainOS receives a personal API key through the private activation screen and discovers channels. When there is exactly one channel for a network, BrainOS selects it automatically; when there are multiple candidates, Daniel chooses the intended account. Selecting a channel does not authorize external writes. The official API uses GraphQL at `https://api.buffer.com`; there is no legacy `/1/updates` integration. See [Buffer quick start](https://developers.buffer.com/guides/getting-started.html) and the [API reference](https://developers.buffer.com/reference.md).

The selected Buffer channel ID is bound to encrypted credentials and immutable approved package input. Discovery checks disconnection, channel locks, queue pause, allowed actions, and Instagram content-publishing scopes. A connected channel is not proof that every format, account type, or plan feature is available. BrainOS preserves unknown capability results until verified and surfaces provider rejection instead of inventing access.

After exact final approval, package cards offer four explicit choices: create a Buffer draft, schedule in BrainOS, add to the BrainOS queue, or send now. Both future choices require an explicit due date and time. Every choice requires fresh human confirmation. Changing the choice or due time clears that confirmation. These controls use the existing approved copy and media; editorial edits require a new approval. A successful request is not publication evidence: the activation delivery table reports observed draft, scheduled, processing, blocked, or published state, and publication records require the provider’s verified outcome.

Future work stays in BrainOS until due. The next healthy hourly operations tick rechecks the exact approval, rights, and claim freshness, then releases it through Buffer’s immediate-send path. The selected time is an earliest delivery time: allow up to about an hour of normal cadence delay, and longer during service interruptions. An existing Buffer draft scheduled for future release is also held locally until due, then released using the same remote ID. This V1 workflow does not put future posts into Buffer’s autonomous queue. Buffer can cache media, so revoking an asset URL alone cannot reliably stop an already scheduled provider post. The adapter supports the official schedule/queue contract and has contract tests, but autonomous future Buffer scheduling is not exposed by this V1 workflow.

The normal server mode is `BRAINOS_EXTERNAL_PUBLISHING=approval_required`. Once an account is connected and its publishing capability is verified, Daniel enables that account from `/activation` with an explicit confirmation. This stores `writes_authorized=true`; it does not approve content or send anything immediately. Exact package approval and a confirmed delivery action are still required for every external mutation, including a remote draft. No environment change or redeployment is needed on account-creation day.

New connections, reconnections, and disconnections reset account write authorization to false. The activation screen always shows `Envíos deshabilitados` or `Envíos autorizados` and allows explicit revocation from the same account card. The central emergency setting `BRAINOS_EXTERNAL_PUBLISHING=disabled` overrides account authorization and stops external writes. Legacy `enabled` mode remains only for a separately authorized legacy/test environment; it is not the normal activation path. Blocked writes never silently switch transport, purchase access, or report a published post. Direct paid X access remains separately guarded.

### Free-plan activation checklist

Checked against [Buffer pricing](https://buffer.com/pricing) on 2026-10-02: Free includes three channels, ten scheduled posts per channel, one API key, and 3,000 API requests per 30 days. Limits also include 100 requests per 15 minutes and 250 per day. A scheduled slot becomes reusable after publication; this is a queue-size limit, not ten lifetime posts. Feature availability can differ by channel and plan.

- Daniel chooses the Free plan and connects Instagram, TikTok, and X as the three channels. Do not add paid channels or a paid trial as an activation shortcut.
- Install the API key through `/activation`, review the automatically selected account for each network with one channel, resolve any multiple-account choices, and inspect any permission, locked-channel, or paused-queue blocker.
- Confirm the intended Instagram account supports automatic publishing; personal-profile reminder flows are not treated as automatic success.
- Check remaining queue capacity and API quota in Buffer before a launch batch. Rate limits remain visible and retry only through the existing recovery workflow.
- Review the exact approved package and ensure its claim-freshness deadline covers its scheduled time. Keep native handoff available when channel access, format support, or quota blocks the API.
- After channel verification, Daniel checks the account-specific consent and selects `Autorizar envíos de esta cuenta` in `/activation`. Then verify a separately authorized real action and its observed result. Setup and account authorization alone create no account, post, or email; no redeployment is needed to grant or revoke this permission.

### Approved media delivery

Buffer accepts media URLs, not binary uploads. It must fetch the direct HTTPS file without a BrainOS session, and the URL must remain available through the actual scheduled publication time. Expiring storage links and Drive preview/share pages do not meet that contract. See [Buffer media hosting](https://developers.buffer.com/guides/hosting-media.html).

BrainOS keeps the storage bucket private. During authorized dispatch it registers a random, per-file capability URL for the exact approved asset. Possession of that URL permits fetching only that asset; treat the URL as sensitive. The delivery runtime checks current approval/dependencies and account permissions, verifies the complete byte count and SHA-256, rechecks approval, and then serves GET, HEAD, or a byte range. Rights, evidence, revision, credential, or cancellation changes can revoke subsequent downloads. This cannot retract bytes already fetched by Buffer, which is why future release remains controlled by BrainOS. Native handoff downloads continue to require the authenticated BrainOS session and do not create these provider URLs.

## Native handoff

Each final-approved package can export a standalone HTML handoff with copy buttons, or text/JSON. The export contains the approved title, caption/body, CTA, attribution, ordered private asset links, and the platform’s official composer destination. It rechecks current evidence, rights, and exact revisions; each asset download checks again. No provider account connection is required for the export. Daniel uploads and completes the final Publish/Send action in the native platform. Downloading or opening the composer creates no publication record. Re-export before publishing because an offline copy cannot learn about later revocations.

## Direct provider applications

Configure HTTPS `CONTENT_OS_ORIGIN` and private client ID/secret per `.env.example`. Exact callbacks: `{CONTENT_OS_ORIGIN}/api/providers/instagram/callback`, `/tiktok/callback`, `/x/callback`, `/youtube/callback`. Register the corresponding route, with no wildcard or trailing slash. Scope declarations are centralized in `src/providers/definitions.ts`.

- Instagram: Instagram Login professional business/creator account; business basic, content publish and insights permissions. Consumer accounts fail capability discovery. Containers, carousel children, Reels and publishing checkpoints use Graph API v25.0.
- TikTok: public direct posting requires an audited app and an appropriate product use case. TikTok expressly excludes a private utility for accounts managed by the developer or their team from acceptable Direct Post clients. Unaudited access is restricted to private viewing. Server-hosted BrainOS media must use `PULL_FROM_URL` under a verified domain or URL prefix; `FILE_UPLOAD` is for media on the user’s device and cannot be used to bypass server-media verification. Creator privacy, duration, disclosure, and consent requirements still apply. BrainOS keeps this direct path blocked unless its configured prerequisites are satisfied; Buffer or native posting is the V1 route. See [TikTok content-sharing guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines).
- YouTube: channel read, upload and analytics scopes; unverified projects may upload privately only. Public/Shorts distribution requires audit/access confirmation. Thumbnail permissions remain channel-dependent. Vercel only streams uploads; transcoding stays local.
- X: OAuth identity and offline tokens, tweet read/write, media.write. All data API calls fail closed while paid access is disabled. Never enable paid access without separate authorization.
- beehiiv: private API key installed through activation; discover/select publication. Posts API access is plan-dependent. No fabricated OAuth URL. Subscriber creation suppresses welcome emails and never automatically reactivates provider unsubscribes.

A successful OAuth exchange is followed by explicit account selection and fresh identity verification. Tokens are encrypted and bound to account IDs. Refresh uses exclusive leases. Missing permission, account mismatch, expiry and provider access are blockers, not successful activation.

## Timer authority and recovery

Supabase Cron is the sole timer: discovery `30 11 * * *` (06:30 Bogota), operations `17 * * * *`. GitHub `newsroom.yml` supports manual recovery only. Install/update timers with `scripts/setup-automation.ts` and private local runtime/management environment. Bearer and deployment bypass are encrypted in Vault, not cron commands. Do not enable a second scheduled trigger.

Expected-window health counts only scheduled runs. Manual success cannot clear a missed scheduled event. Leased automation is idempotent per lane/window/event. The operations tick executes due work and records read-only DB/Drive/worker smoke status. OAuth attempts expire and are pruned after seven days; editorial, media, publication and approval history is never automatically deleted. Worker logs rotate locally; failed exports retain attempt history and exact source revisions. Temporary media/object deletion requires inspection and explicit choice.

## Secret changes

Use a permission-600 private configuration file with `scripts/configure-provider-preview.py FILE --project-id ID --team-id ID`; validate first, then add `--apply` to stage encrypted **preview-only** values. The command cannot enable paid access or publication. Deploy and verify the next preview before retiring old credentials. Provider client-secret replacement requires the provider dashboard's rotation mechanism and fresh health verification; do not revoke existing grants blindly.

Worker rotation supports previous-token overlap, with `PRODUCTION_WORKER_TOKEN_PREVIOUS_UNTIL` at most 90 minutes ahead. Stage new runtime token plus overlap, deploy preview, update the private launchd environment while idle, restart via `scripts/media/service.py`, verify heartbeat/auth and remove overlap. Never put tokens in the plist.

For integration-key rotation, retain `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` alongside the new current key. `scripts/rekey-connections.ts` defaults to decrypt-only validation; `--apply` re-encrypts provider/Drive credentials without logging plaintext. Pause active work and take a private DB snapshot before applying. Keep the previous key through OAuth state/cookie expiry and successful Drive/provider verification, then remove it. This pass did not rotate any live credentials or rewrite Git history.

## Constraints and evidence

Provider API version/rules are centralized. BrainOS imposes a conservative 50 MB H264 MP4 delivery limit, vertical short-video policy, and 2 MB thumbnail limit; these are BrainOS policies, not claims of every provider's maximum. Analytics stores raw responses, semantic names, due/start/capture timestamps and lateness. Transport tests mock official responses; only account-connected live checks can establish provider verification.

Official references: [Instagram](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [TikTok](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post), [X pricing](https://docs.x.com/x-api/getting-started/pricing), [YouTube upload](https://developers.google.com/youtube/v3/docs/videos/insert), [beehiiv posts](https://developers.beehiiv.com/api-reference/posts/create), [Supabase Cron](https://supabase.com/docs/guides/cron).

## Shared Google client and verified read access

YouTube can reuse the existing BrainOS Google Web client through encrypted preview `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` values copied from the Drive client. It retains its own YouTube callback, three YouTube scopes, PKCE, state cookie and account-bound encrypted token. Drive tokens are not copied into the YouTube connection. When those client IDs match, YouTube disconnect removes its local credential and authorization only: Google project revocation would revoke Drive as well. Full project revocation remains available in Google account permissions with that consequence explicitly described.

beehiiv discovery verifies publication statistics, subscriber-list and post-list reads independently. A successful read never enables the Send/Create Post API; `BEEHIIV_POSTS_PLAN_ACCESS_REQUIRED` remains until write entitlement is verified. Native/manual handoff remains available. Subscriber synchronization remains opt-in; read verification does not send subscriber records, welcome emails or newsletter content. Account-recovery blockers in launch state are presented without creating or connecting an account.
