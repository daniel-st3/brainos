# Automated newsroom: staging experiment, 2026-10-08

Starting HEAD: ff8d158e58ce1032c4c935f4e296cece1ce728ad.

## Observed production system

- Supabase Cron: discovery 11:30 UTC (06:30 Bogotá); operations hourly at :17. October 8 discovery sources succeeded. Original registry/scoring/pilot remain unchanged through October 13.
- The approved first Wikimedia candidate has a reconciled publication receipt. Its Buffer post is sent. Exact internal IDs and private metrics remain in the local audit evidence, not this public repository. Read-only checks, no retry or new post.
- Day-one analytics job succeeded; day-three/day-seven jobs remain scheduled. A real Buffer metrics snapshot was returned. No performance conclusions drawn from this early snapshot.
- Encrypted Google connection, Gmail notification CAS claims and immutable final candidate/outbox are working infrastructure. Existing email is title plus authenticated link; rich inline media/caption email is NOT implemented.
- Local worker heartbeat current; transcription/render jobs still depend on that worker. It is not a cloud creative executor. C2's face-led Reel was not touched.
- Existing research and caption drafting use deterministic code, not an unattended editorial language model. Existing SVG/Sharp cards are not suitable substitutes for the requested creative quality.

## Implemented scope

A separate creator-discovery/v1 staging lane; six public feeds (OpenAI, Google AI, TechCrunch AI, The Verge AI, WIRED AI, Ars technology). Separate creator_discovery_runs table; no writes to baseline stories, source registry, pilot, approvals, outbox or publications. Independent authenticated brief document at /creator-briefs, no approval controls. Scheduler endpoint is bearer-authenticated and disabled unless BRAINOS_CREATOR_STAGING=true.

Requested 30/25/20/15/10 weights retained. Inputs are deliberately disclosed keyword/feed metadata proxies, NOT editorial judgment or an aesthetic score. The first version does not establish that its ranking outperforms Daniel. Scores, dimensions, source hashes, times, media URLs, blockers and source health are retained per hourly slot. Missing timestamps, future/stale entries, absent AI relevance/hook signals are excluded from the shortlist. Maximum two research leads, including zero; no forced quota. Canonical URL dedup only, not semantic event dedup.

Every result is STORY_BRIEF / publishable:false. Feed image references remain UNCLEAR, not downloaded or licensed by inference. No final candidate or review email is created from a brief. A recoverable lease prevents overlapping/repeated hourly runs; completed snapshots cannot be replaced through the finish RPC. Direct anon/authenticated table/RPC access is denied. Existing editor auth controls reads.

## Sources: staged now vs later

The six feed endpoints responded successfully and parsed on October 8. Google feed redirects within its official origin. Official sources supply attributed evidence; journalism supplies leads. Neither alone verifies every claim. Feed excerpts are bounded and private.

Anthropic, Meta, xAI, robotics publishers and official YouTube channel feeds should be added only after their exact stable endpoints and permitted access are tested. Reddit/X signals need an authorized supported retrieval path, not scraping or evasion. No claim of coverage across those sources in this version. No paywall bypass. Primary article retrieval, cross-source event clustering and claim verification remain unimplemented in this lane.

## Creative executor decision

| Tool | Finding / decision |
|---|---|
| Canva Pro Autofill | Current official docs now allow Pro, Teams and Enterprise. Earlier Enterprise-only conclusion was stale. It can fill prepared text/image/video/chart data fields and export via REST. It does not invent scene composition or turn arbitrary Canva elements into reliable editable fields. Connected account returned no non-empty brand-template datasets; the existing DVNI Altman hybrid design returned an empty dataset. No design was modified. |
| Canva server authorization | ChatGPT's connector is not BrainOS OAuth. No CANVA runtime client/token configuration exists in local or Vercel env. A developer integration, OAuth scopes/consent, and a tested fillable design are missing. Pro entitlement is documented; this account's successful REST Autofill/export is NOT proven. |
| Sharp | Already installed; suitable for image crop/composite/PNG QA with explicit story-specific composition. Existing generic card renderer is not promoted as final creative. |
| Remotion + FFmpeg | Best next test for source-footage motion, captions, split-screen, audio and deterministic encoding. Remotion free license covers individuals and teams up to three; larger commercial organizations require paid licensing. Not MIT. No dependency installed or paid renderer provisioned. Needs an actual story composition, cleared footage/audio, bounded renderer job and visual QA. |
| GitHub Actions | Existing public repository can use standard Linux hosted runners without incremental runner-minute charges; storage/cache limits still apply. A manual renderer job triggered by Supabase can avoid a second timer. This is a proposed execution site, NOT a proven current renderer. Do not upload private assets as public workflow artifacts or expose service credentials to generated code. |
| Codex CLI | Official noninteractive/headless operation exists and local auth mode is ChatGPT. Desktop login is not already a dedicated durable cloud executor. Shared rotating refresh tokens must not be copied blindly across concurrent runtimes. No credentials were transferred. |
| Sign in with ChatGPT | Official plan-usage route supports open-source/local apps and self-hosted VMs with stable host ID, OAuth consent and VM-owned refresh. Remotely hosted app eligibility is separate (interest/registration path). BrainOS has no such registration/consent/host yet. No unrestricted unattended image generation via this route; image generation tool is explicitly unsupported. |
| OpenAI image API | Separately billed; not enabled and no paid calls made. ChatGPT image creation remains manual. No factual evidence will be synthesized. |
| Spare M1 | Practical fallback for dedicated Codex + FFmpeg/Sharp and later Remotion, while main Mac sleeps. Requires the spare to remain powered/networked and owner authorization. Not configured or claimed cloud-hosted. |

DVNI Taste Profile V1 was read from C2's existing artifact. No C2 files, fonts, palette, templates or taste rules were modified. Observed preferences remain provisional, not an automated quality taxonomy.

## Buffer current API audit

- Mixed image/video carousel: earlier private-draft acceptance retained; image carousel live delivery now observed. No new post created.
- Reels: current schema supports Instagram type=reel and video assets; not end-to-end published by this pass.
- Thumbnail: API explicitly rejects custom thumbnailUrl; supports video metadata.thumbnailOffset for an embedded frame. BrainOS currently chooses frame zero. No promise of arbitrary custom cover upload.
- Music: experimental audio catalog exists, but this account returned ChannelRefreshRequired. InstagramPostMetadataInput has no audio attachment field; stickerFields.music is reminder/manual metadata. Automated Instagram music selection is NOT verified. Prefer legitimately licensed audio mixed into final MP4, with retained provenance, once renderer exists.
- Scheduled publishing exists through existing guarded outbox due_at; no new schedule/post was created.
- Metrics query worked against the real published post. Free key policies read live: 100/15 minutes, 250/day, 3,000/30 days. Count existing hourly health and reconciliation, not just posts, before scaling.

## Costs and limits

No paid services provisioned, no paid generation calls. Existing subscription capacity is a consumed resource, not zero economic cost. Standard public GitHub runner minutes are free; do not infer unlimited storage. Vercel/Supabase existing plan/storage/egress limits still apply; no full account invoice audit was available in this pass. Six bounded feed requests per run, max 100 saved briefs, max 1 MB snapshot. Four daily runs => at most 4 MB/day of snapshots before DB overhead; actual snapshots are smaller. Retention deletion is not silently enabled.

No credible all-in 4/day rendering cost can be given before measuring a real render, source-media size, CPU time, storage and model usage. Canva Pro API eligibility does not imply unlimited Autofill/export quotas.

## Exit condition / remaining blocker

This pass does not prove scheduled discovery → final creative → review email. It proves independent hosted discovery only. The missing production step is a dedicated supported editorial/creative executor, not another approval service. Smallest next dependency is owner-authorized subscription-backed executor on a dedicated host (or separately authorized paid inference), followed by ONE cleared-media story through actual render and mobile visual QA. A server Canva OAuth client plus a validated fillable composition is an alternative, not an existing integration.

10:00/17:00 review deliveries are NOT activated until genuine final candidates exist. Proposed discovery updates are 08:00, 10:00, 14:00, 17:00 Bogotá, independent of the frozen 06:30 pilot. No recurring publication or four-candidate quota is enabled.

## Current official references

- https://www.canva.dev/docs/apps/rest-apis/autofill-guide/
- https://community.canva.dev/t/autofill-apis-are-now-available-on-canva-pro-and-above/8922
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/codex/auth/
- https://developers.openai.com/codex/noninteractive/
- https://www.remotion.dev/docs/license/faq
- https://www.remotion.dev/docs/ssr
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://developers.buffer.com/guides/api-limits.html
- https://developers.buffer.com/reference.html
- https://supabase.com/docs/guides/cron/quickstart

## Deployment notes

- Preview: https://brainos-ok4z7muyl-daniel-st3s-projects.vercel.app/creator-briefs (application code afa001c).
- Deployment-only BRAINOS_CREATOR_STAGING=true; no project-wide editorial credentials added.
- Vercel's generated project alias moved despite autoAssignCustomDomains:false. It was immediately restored to its prior deployment and verified. The creator cron is pinned to the unique preview URL; no production deployment/promotion was requested.
- Supabase dispatcher reads the separate brainos_creator_staging_origin Vault entry and existing scheduler bearer/bypass. It cannot fall back to the live app. Original discovery and operations timers are untouched.
- 466 unit tests; 27 E2E; lint/typecheck/build passed. DB validation passed with 43 RLS tables. Sandbox IPC restrictions required running DB/E2E checks with local test-server permission, not an application change.

## Hosted proof

- Supabase cron job started at 2026-10-08T21:41:00Z, while no local discovery runner was running.
- Hosted slot 2026-10-08T21 completed at 21:41:02.469739Z; 6/6 feeds healthy, 100 retained briefs, two research leads. Stored snapshot 118,454 bytes. Not a final creative candidate.
- Repeated hosted request 163 returned HTTP 200 / ALREADY_CLAIMED; no duplicate snapshot or email.
- Temporary per-minute proof timer removed. Active creator staging schedule: `0 13,15,19,22 * * *` UTC = 08:00/10:00/14:00/17:00 Bogotá. Existing `30 11 * * *` and `17 * * * *` timers unchanged.
- Deployed authenticated GET returned 200; anonymous GET and POST returned 401. Desktop and 390px screenshots inspected; no horizontal overflow, no publication/approval controls.
- No final candidate, Gmail notification, media render or social publication was created by this experiment. The requested complete unattended creative-production success condition remains unproven.
