# Autonomous newsroom: first bounded staging worker

This is a production experiment, not an established creative standard. No new orchestration vendor, feeds, discovery weights, platform adapter, public palette or template was added. C2 work and live publications are untouched.

## Execution and authorization

`codex exec` is the official noninteractive CLI. The worker invokes the local signed-in CLI with a fresh context per selection/composition/QA step; it does not export desktop tokens or use an API key. User config, apps, shell, web/computer tools are disabled. Only source evidence and prepared images enter model context. Model output is structured data, never executable code. SVG is bounded and disallows scripts, foreign objects, external resources and entities before Sharp rendering. Source retrieval uses the existing public-URL/DNS checks, bounded requests, and no login cookies.

The model is `gpt-6.1-sol`, high reasoning. Installed proof CLI: `0.162.0-alpha.2`. It is not pinned as a production release on the spare yet. Each call has a five-minute deadline. Metrics retain input/output/cached tokens and elapsed time. Existing ChatGPT/Codex allowance is consumed; no incremental API charge is incurred. Rate limits or revoked login stop processing rather than falling back to paid inference. The test machine is the main Mac; the spare has NOT been provisioned.

Official sources: https://developers.openai.com/codex/noninteractive/ and https://developers.openai.com/codex/auth/.

## Existing hosted queue, constrained executor

The existing creator snapshot can enqueue one `control_jobs.kind=creative` job with `runner=newsroom-exec/v1`. Its parent is an isolated staging experiment, not a Creative Lab contract. A dedicated SQL claimant ignores other creative/C2 jobs, uses a row lock and fenced lease, and bounds crash retries to three. The worker uses the existing scoped production-worker credential, never a Supabase service key. It polls HTTPS outbound; there is no inbound port.

`BRAINOS_AUTONOMOUS_STAGING=true` enables this staging experiment. Leave it OFF on the normal discovery deployment until the first complete quality run is accepted. Queue at most one unfinished job. No production cadence or four-post quota is enabled. Pilot records/ranking are unchanged.

Pipeline: existing scheduled snapshot → model selection → primary source retrieval (record unavailable sources, no access-control workaround) → authentic source images → evidence-bound Spanish copy → per-story SVG composition → native 1080×1350 PNGs → independent model review of actual 390px images against original source images, URLs and checksums → at most one revision → private upload/checksum verification → existing immutable review → existing Gmail delivery.

This first renderer handles a three-image carousel only. It does NOT implement premium video, narration, sound design, subtitles or new multi-platform exports. The source assets remain UNCLEAR. The worker cannot clear rights, supply a publication binding, approve anything, or invoke Buffer. Its real-story candidates are in isolated staging/private review; a visual pass does not establish live publication eligibility. A failed quality gate creates NO candidate and sends NO “ready” email.

The final result is retained in job.result before email. If a completion response is lost, inspect that result; do not rerun content creation. Existing notification CAS prevents blind duplicate sends. Failed jobs remain inspectable in existing operations; no dashboard is added.

## Passwordless scoped review

`BRAINOS_EMAIL_REVIEW_LINKS=true` replaces new notification links with a 24-hour encrypted candidate capability in the URL fragment. The fragment never goes to server request logs or Referer. The page removes it from browser history and exchanges it through a same-origin POST for an HttpOnly, SameSite=Strict cookie scoped to that candidate API path. It grants no access to other stories, candidates, settings or accounts. Frame embedding is denied.

Opening/email scanning cannot approve or publish. Daniel must press a decision button. The existing exact candidate checksum, revision, rights and immutable CAS decision guards remain authoritative. Audit records retain the owner, decision timestamp and grant fingerprint, not the bearer secret. Replaying a decision cannot change it or create a second outbox. Stale/expired/wrong-owner/wrong-candidate/tampered grants fail. Possession of this private email link is the authorization factor; forwarding it delegates access until expiry. No new account/password is required.

After a valid approval durably creates the outbox, the endpoint asks the existing Supabase HTTP dispatcher to wake. It never calls Buffer synchronously. Wake failure leaves the outbox intact for the existing cron. Schedules remain due_at-gated.

## Spare Mac setup (one-time, not yet executed)

Use a dedicated macOS user with only BrainOS worker configuration. Install Node 24, repository locked dependencies and the official Codex CLI; run `codex login` with Daniel's ChatGPT account on that Mac. Do NOT copy the main Mac auth file. Keep the spare powered, networked and awake. A launch agent begins after login; FileVault/reboot and deliberate sleep still require normal macOS handling.

Private JSON (0600) outside the repository: `node` and `codex` absolute binary paths; `origin` exact staging URL; existing scoped `worker_token`; optional deployment `bypass`. No infrastructure or social credentials.

```
python3 scripts/newsroom/service.py install --config /private/path/newsroom.json
python3 scripts/newsroom/service.py start
python3 scripts/newsroom/service.py status
python3 scripts/newsroom/service.py stop
```

Installer copies runtime/dependencies into Application Support, but no Codex auth. Supervisor uses a singleton lock, restart throttling, 60-second idle polling, five-minute error backoff and bounded logs. A power assertion exists only during a claimed job. No main-Mac service was installed by this pass.

## Capability and orchestration decisions

- Instagram: existing Buffer image carousel/mixed carousel/Reel publication path retained. Existing frame-offset covers remain. Direct custom `cover_url` is a potential enhancement, not implemented or verified with this account.
- TikTok: stored Buffer connection reports publish/media/schedule. Public delivery has not been demonstrated; no cross-post is authorized by an Instagram-only candidate.
- YouTube: stored direct connection has identity/upload/analytics. Public publishing is NOT enabled merely by OAuth: unaudited projects remain private-upload-only (https://developers.google.com/youtube/v3/docs/videos/insert).
- X: account recovery remains unresolved. No connection or API spend. Read budget remains $0 until explicit authorization; current X pricing is metered (https://docs.x.com/x-api/getting-started/pricing).
- n8n: free self-hosted Community edition is source-available under Sustainable Use License, with hosting/maintenance obligations (https://support.n8n.io/article/can-i-use-your-license-for-my-use-case). It adds no demonstrated advantage to the existing leases, scheduler and outbox.
- Make: free plan currently advertises 1,000 credits/month, two active scenarios, 15-minute minimum scheduling and five-minute execution (https://www.make.com/en/pricing). It does not solve rendering quality or spare-host authentication. Not introduced.

Calendar, additional sources, API reads and cross-platform exports remain deferred behind the first genuine quality candidate. No generic rights override was added.

## Observed proof — 8 October 2026, Bogotá

Application preview: https://brainos-newsroom-daniel-st3s-projects.vercel.app (application commit `9bf1cc4e5f03dce6977b788fc3d00cbf52c0c240`). The normal BrainOS alias was not moved. Only this new staging alias has a Vercel protection exception; private app routes still require editor auth, and candidate routes require their scoped grant.

Hosted job `16569ff3-8b4b-4bfe-b687-d486f8eb83dc` consumed an existing scheduled creator snapshot. Its first attempt failed creative QA and created no candidate. Daniel explicitly authorized one corrected attempt after the QA input was fixed to include original source imagery. That attempt completed without an interactive model conversation or manual media import, producing **Gemini recibe el encargo**, three exact 1080×1350 PNGs and a 73-word Spanish caption.

Candidate `545e2b3d-a817-4356-a24f-545ca12e5c3a` is AWAITING_DANIEL, in private staging, with no decision or outbox. Gmail retained SENT at `2026-10-09T02:25:21.446Z`. This proves Gmail acceptance, not inbox arrival. Source-media rights remain UNCLEAR; this candidate is NOT eligible for publication. A visual QA pass is not Daniel's approval or a final DVNI style standard.

Corrected attempt: 323.095 seconds research/render/QA, approximately 332.493 seconds including hosted handoff, 3 Codex calls, 115,371 reported input tokens (46,720 cached), 9,105 reported output tokens. Failed attempts consumed additional allowance and are retained separately in private proof files. No incremental paid API calls. The executor ran on the main Mac for this test; spare-Mac installation and main-Mac-independent execution remain UNPROVEN.

Hosted phone (390px) and desktop checks verified all three images, no overflow, no secret in URL history, HttpOnly/Secure/Strict candidate-path cookie, 401 for invalid/wrong-candidate access, 403 for cross-origin exchange, and unchanged decision/outbox after viewing. The email's secret fragment is intentionally not stored in this document.

Validation: 484 unit tests, 28 browser tests, lint, typecheck, build and 43-table RLS validation passed locally. GitHub CI passed for the application commit above. Live state remained three published outbox entries, no pending live retry; original discovery/operations/creator schedules were unchanged. No recurring creative production was enabled. Premium video, source-media publication eligibility, and an always-available spare executor remain separate unmet release requirements.

## Efficiency measurement and spare-worker hardening — 8 October 2026

Original successful run, `gpt-6.1-sol` / high reasoning / CLI `0.162.0-alpha.2`:

| Call        |   Input | Output | Cached input (subset) | Reported total | Seconds |
| ----------- | ------: | -----: | --------------------: | -------------: | ------: |
| Selection   |  20,983 |    336 |                     0 |         21,319 |  15.869 |
| Composition |  21,832 |  7,529 |                     0 |         29,361 | 248.636 |
| Visual QA   |  72,556 |  1,240 |                46,720 |         73,796 |  56.717 |
| Total       | 115,371 |  9,105 |                46,720 |        124,476 | 321.222 |

Overall worker completion took 332.493 seconds including retrieval/render/upload/email. There were no tool events or documentation reads in any model call. QA emitted an extra progress message before its final JSON. The 40,000-character primary excerpt was repeated for composition and independent QA. Fresh sessions also carried general runtime instructions/context. Aggregate CLI usage does not identify an exact token charge for each instruction/image/internal pass, so these are observed contributors, not a fabricated per-component accounting.

Each invocation now checks that local authentication still uses ChatGPT and fails closed if it has changed to API-key login. The worker now uses a concise task-specific `model_instructions_file`, disables plugin/hook/memory features, disables project document injection, and requests one final structured response with no progress preamble. The same model, high reasoning, output schemas, source evidence, original images, independent QA criteria, rights rules and iteration limits remain. No source excerpt was shortened, originals removed, or quality gate relaxed. Metrics now also retain prompt/schema/instruction hashes, input image hashes/bytes, visible error count and agent-message count.

**Measured QA-only replay:** same unchanged Gemini media, all three originals, all three phone-size images, complete source excerpt and caption. 18,400 input + 1,103 output = **19,503 reported tokens**, zero cached, zero tool events, one final message, zero visible errors; **46.756 seconds**. This is **73.57% fewer reported QA tokens** and **17.56% less QA wall time**. Both reviews passed for Daniel's private review and independently flagged small credits, the vendor-evidence limitation and unresolved rights. This single replay does not prove aesthetic acceptance, general quality equivalence or full-pipeline savings. Cached tokens are already included in input; reported token savings are not a claim of equivalent subscription-quota or dollar savings.

Private measurement evidence: `.data/autonomous-proof/efficiency-qa-v1/comparison.json`, metrics and event log. Replay prompt SHA-256 `3d4c700bde01ceb9c738f36efb9385b5d4fdf937f5b2ff12833780594853636a`; instructions SHA-256 `5c8378c9b2587510f0c466c9b77af04797859dc171f0e9afe6c8886a0901ff63`. Original package and candidate were not modified; no new candidate, email, render or hosted job was created. The next complete creative run and whole-pipeline measurement wait for Daniel's feedback.

Repeat only when authorized, using `node --import ./node_modules/tsx/dist/loader.mjs scripts/newsroom/measure-qa.mjs <existing-proof-directory> <new-empty-output-directory>`. This helper cannot enqueue, upload, notify or publish. It verifies original media checksums before QA and unchanged input hashes afterward.

Executed using existing ChatGPT/Codex subscription capacity. No incremental API charge. Subscription usage is still a consumed resource.

See [spare-M1 handoff](spare-m1-newsroom.md) for exact setup and remaining on-device verification. No production discovery, approval, outbox, Gmail, Buffer, account or release behavior changed. Premium video remains the next creative milestone, not implemented here: Daniel's actual Gemini feedback, authentic footage and source basis, narration/audio rights, per-story editing, full-duration mobile playback and subtitle/audio QA must precede a release claim.
