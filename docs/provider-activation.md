# Provider activation and safe operations

The preview is the control plane. External writes and subscriber synchronization are disabled by default. Creating a platform account alone does not satisfy developer-app review/access requirements.

Use `/activation` to record account creation, handle availability, 2FA/recovery checklist, editable profile revisions, connection/capabilities and profile drift. `/operations-center` exposes timers, worker health, failed jobs, safe recovery and notification acknowledgement. `/recording-demo` is a read-only presentation of fictional fixtures, never live outcomes.

## Applications

Configure HTTPS `CONTENT_OS_ORIGIN` and private client ID/secret per `.env.example`. Exact callbacks: `{CONTENT_OS_ORIGIN}/api/providers/instagram/callback`, `/tiktok/callback`, `/x/callback`, `/youtube/callback`. Register the corresponding route, with no wildcard or trailing slash. Scope declarations are centralized in `src/providers/definitions.ts`.

- Instagram: Instagram Login professional business/creator account; business basic, content publish and insights permissions. Consumer accounts fail capability discovery. Containers, carousel children, Reels and publishing checkpoints use Graph API v25.0.
- TikTok: user identity/profile, video.list and video.publish; creator privacy/duration is re-checked at dispatch. Content Posting audit is required before real publishing. The transport uses official FILE_UPLOAD with a checkpointed publish ID and bounded binary streaming, avoiding the PULL_FROM_URL domain-verification requirement. Interrupted uploads are reconciled instead of creating another post.
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
