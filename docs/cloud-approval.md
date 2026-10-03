# Cloud approval: Supabase + Vercel + existing hosted outbox

Trigger.dev is **not required** for production approval. Its isolated task adapter remains experimental/optional; production routes do not import or wake it. No Trigger credentials or deployment are needed.

## Production flow

Prepared, approved platform package → `POST /api/approvals` → immutable `cloud_approval_v1` review + notification → `AWAITING_DANIEL` in hosted Supabase → authenticated phone decision → exact revision validation → durable decision → `resumeCandidate()` → existing immutable provider outbox → existing Supabase cron / Vercel automation → due-time and approval revalidation → provider receipt + analytics jobs.

New candidates have `expires_at: null`: waiting consumes no worker/process and has no deadline. Previously created candidates retain their original immutable expiry. Waiting indefinitely is not unlimited permission: approval and dispatch still check exact content/draft/package/media revisions, rights, claims freshness and target identity. A requested schedule that passed before approval requires a new candidate.

The HTTP success boundary is `saved: true` with `outbox_id` for an approval. There is **no synchronous social dispatch**. Reject and request-changes retain the decision and cannot enqueue. If the request ends after persisting approval, the existing automation recovers approved candidates with the same idempotency key before processing the outbox. Stale candidates fail revalidation. Repeated decisions/resumes cannot create another publication.

Existing `brainos-operations` runs at minute 17 each hour. Discovery also invokes hosted operations. No second scheduler or production content cadence is introduced. A scheduled item is eligible at `due_at` and is dispatched on the next successful hosted tick, **not necessarily at the exact requested minute**. Database claims enforce `due_at <= now()`; the immutable candidate schedule is also checked before dispatch.

Automation processes live and isolated simulator outboxes separately. Demo candidates require demo accounts and the simulator adapter; they cannot fall through to a live social provider. `staging: true` on candidate creation selects the demo namespace and still requires authenticated editor access and the same guards.

## Gmail review notification

The existing Google web client and callback support an explicit optional send-consent action:
`/api/integrations/google/start?notifications=true` (also linked from `/review`).

Daniel signs in with the configured personal Google account. Existing Drive scope is preserved; the only new Gmail permission is `https://www.googleapis.com/auth/gmail.send`. No inbox read, modify, compose, ChatGPT connector, new account, or paid vendor is used. Google requires Gmail API enabled in the existing Cloud project and consent for the send scope. No new redirect URI/client is needed.

The encrypted OAuth state binds editor, purpose, expiry and PKCE. The callback verifies the expected personal Drive account/root and both required scopes before replacing the encrypted server-side refresh token. Failed/partial consent leaves the previous connection intact. The sender refreshes that exact stored connection and verifies the personal identity; it never uses an unrelated environment refresh token.

The message contains only the fixed subject “DVNI post ready for review”, story title and configured HTTPS origin + authenticated review URL. Recipient is the existing verified personal Google account, not a request parameter. No approval token, checksum, media or server credential is included. Demo mail is labelled SIMULATION.

Candidate creation attempts delivery; existing hosted automation retries pending/definitively rejected sends. Concurrent sends use control-record compare-and-swap. `SENT` records the Gmail ID. `BLOCKED` retains a sanitized status (for example Gmail API disabled/consent failure). `SENDING` interrupted after two minutes and ambiguous network/5xx outcomes become `UNKNOWN`, never blindly resent: Gmail has no exactly-once send key. Message-ID is stable but is not claimed as a deduplication guarantee. Provider acceptance is not proof of phone notification settings or inbox delivery.

Without consent, status is `GMAIL_CONSENT_REQUIRED`; review/approval/outbox still work. Google external apps in Testing can have short-lived refresh authorization; unattended long-term operation requires the existing OAuth app's appropriate publishing status. Do not claim lifetime authorization from a successful consent.

## Mac dependency

For a **prepared final package**, the critical path uses hosted Supabase data/private media, authenticated Vercel routes, existing Supabase cron and hosted provider/simulator adapters. No local worker, terminal, browser automation or Codex process is required to wait or dispatch. Local tools used for deploying/observing tests are not runtime dependencies. Phone/browser activity is needed only to submit the human decision.

Recording, local transcription and video rendering remain outside this proof and may still depend on the Mac. No creative grammar or creative automation changed.

## Provider findings (official docs checked 2026-10-03)

BrainOS's Buffer adapter already supports image posts/carousels, a single video, text/threads where the connected network permits, and explicit automatic publishing, with normalized failures, retries, receipts and cancellation boundaries. Notification-only channel modes do **not** meet the single-decision unattended requirement.

The [Buffer GraphQL reference](https://developers.buffer.com/reference.html) exposes ordered `assets`, and the [media hosting guide](https://developers.buffer.com/guides/hosting-media.html) requires provider-fetchable hosted URLs. This does not prove every media combination is accepted for every channel.

Buffer's current official help pages conflict: [Using Instagram](https://support.buffer.com/en-us/articles/using-instagram-with-buffer-YSjg2dXFV8) advertises mixed-media carousels, whereas [Scheduling Instagram](https://support.buffer.com/en-us/articles/scheduling-instagram-posts-reels-stories-and-notifications-3XA98S9Q5p) says mixed media is unsupported. Consequently **mixed image/video Buffer publishing remains unverified and blocked in BrainOS**; no live test or speculative adapter rewrite was made. The first production test should use an already-supported image carousel or one video. This evidence does not establish that direct Meta is required. Existing direct-provider architecture is preserved.

YouTube's private-only audit limit and beehiiv's Posts plan limit remain blockers to their corresponding public sends. X recovery remains untouched.

## Verification boundary

Tests must distinguish local contracts from hosted proof. Hosted proof creates candidates through deployed Vercel, checks persisted waiting/queued records, invokes the existing Supabase-hosted dispatch function (no local outbox executor), closes the setup/browser process, and then reads receipts from Supabase. Before-due and after-due snapshots must retain the same immutable schedule. Never label a simulator receipt a real social publication.

Official references: [Gmail send](https://developers.google.com/workspace/gmail/api/guides/sending), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [incremental Google authorization](https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth).
