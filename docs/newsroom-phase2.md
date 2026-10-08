# Phase 2: execution eligibility and one private render experiment

Date: 2026-10-08. Starting HEAD: `91a19c3435fcf7d0a5b003d7f688257b2b808dc4`.

## Editorial executor decision

No unattended editorial executor is authorized yet. Do not confuse the current interactive engineering session with one.

| Option                             | Eligibility / observed state                                                                                                                                                                                                                                                  | Decision                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current private Vercel application | Remotely hosted, even though single-editor. Official SIWC documentation directs remotely hosted applications to an interest form; selected private apps are eligible, but no BrainOS approval/registration was found. No SIWC/ChatGPT runtime configuration exists in Vercel. | BLOCKED pending explicit eligibility and owner authorization. Do not use the dynamic local-client registration to evade this boundary.                   |
| Open-source client                 | GitHub reports public visibility, `license: null`; repository has no root open-source license. Publicly readable is not proof of open-source licensing or hosted-service eligibility.                                                                                         | Not established. Do not relicense Daniel's project without authorization.                                                                                |
| Self-hosted application            | Official VM guide explicitly covers an open-source application on an owner-controlled VM, distinct host ID and protected registration. It does not make arbitrary Vercel/GitHub execution eligible. No dedicated VM exists here.                                              | Technically documented; BrainOS deployment eligibility and authorization unproven.                                                                       |
| Spare M1 personal/local executor   | Official cookbook covers personal projects running locally; Codex supports noninteractive execution. Requires fresh official sign-in on the spare, account eligibility/plan permission, and an available dedicated host.                                                      | Preferred no-new-API-cost authorization target. Not activated or tested on that Mac. Existing allowance is consumed; electricity/network still required. |
| Metered API                        | Separately billed, not covered by ChatGPT subscription.                                                                                                                                                                                                                       | Costed alternative only. No key requested, no API request made.                                                                                          |

Illustrative standard API budget from current official prices: 20,000 input + 4,000 output tokens costs $0.004 with GPT-6 Luna ($0.10/$0.50 per million), or $0.08 with GPT-6.1 Sol ($2/$10). At 120 candidates/month: $0.48 or $9.60 respectively, **before** retries, additional QA/research calls, tool charges and extra reasoning output. These are arithmetic examples, not measured quality or full-pipeline quotes. The cheaper model has not been validated for editorial release.

No desktop Codex credential was read, copied, or exported. No paid inference or provider was provisioned. SIWC authorization is distinct from OpenAI identity sign-in and from access to ChatGPT conversations. Plan-based image generation is not supported by the documented preview.

## Canva experiment

Using the existing official Canva connector authorization, created a new isolated technical test design. Existing C2 designs were not modified. Requested 1080×1350; Canva returned 1080×1440. Dataset initially empty. Two explicit `HEADLINE` and `SOURCE` field edits succeeded in a draft transaction.

The editing tool requires preview approval before committing changes. Preview and the save/test question were shown to Daniel. Until he approves that save, the fields are not persisted and an Autofill test is not valid. No claim of successful Autofill or export.

Official current REST/MCP documentation lists Pro and above as eligible (older Enterprise-only information is stale). Account-specific success still requires an actual filled design. The ChatGPT Canva connector is **not** a reusable BrainOS server credential. No Canva client/OAuth token exists in BrainOS runtime. Creating a developer integration and owner OAuth is a separate server authorization step, not a reason to export the connector credential. Do not choose Canva as the unattended production renderer until that is proven.

## Selected real story and source verification

Google AI Edge Foresight, present in the hosted creator brief snapshot. Selected for practical audience relevance, a tangible offline/privacy hook, and an authentic product demonstration. This selection was made during interactive engineering review; no claim that the keyword heuristic selected it. Existing lane/pilot ranking was not changed.

Primary page and its embedded official product page confirm local meeting transcription, shorthand-to-notes enrichment, offline operation and Apple Silicon optimization. These are **attributed publisher claims**, not independently benchmarked performance. Spanish accuracy remains untested. A 68-word Spanish reference caption is saved privately and explicitly labeled non-autonomous.

Authentic source: Google's `enhanced-notetaking.gif`, 786×474, 347 frames, 23.13 seconds. SHA-256: `e5bf22a092d46a4a1b9f360b68da2b9189de84d82b904fb6de83c422c31d00f4`.

Rights remain **UNCLEAR**. The embedded product page says all rights reserved. Google's documentation CC policy does not automatically cover linked multimedia. This test does not claim a defensible publication clearance. No private processing result may enter publication solely because the file is publicly accessible.

## Renderer experiment

Implemented only a manually triggered, credential-free experiment in `creative-render-proof.yml` and the one-story `foresight-render.mjs` script. No new scheduler, renderer service, product endpoint, database migration, approval logic or feed.

Reuses installed Sharp; FFmpeg encodes real source motion into a 1080×1350 H.264/YUV420P, 30fps MP4. It preserves source identity/hash and labels the output PRIVATE / RIGHTS PENDING / DO NOT PUBLISH. No synthetic factual imagery, soundtrack, voice, or generic reusable news-card template. Typography/color choices are temporary technical composition inputs, not public DVNI grammar.

Automated checks: source checksum and dimensions/frame count, bounded caption length, full output decode, three frame dimensions and bounded file size. A deliberately altered source fails before rendering. Local technical render completed in 2.9 seconds; this excludes installation and cloud provisioning. The 390px inspection found product UI detail too small. **Visual release failed; technical success is not publication quality.**

Remotion officially supports GitHub Actions / Node rendering, but adds browser/composition dependencies unnecessary for this particular source-motion test. Its license is not MIT: free for individuals/companies up to three people; larger collaborations/organizations require licensing. No Remotion dependency installed. FFmpeg/Sharp is the smallest tested renderer here; Remotion remains an evaluated option for a later demonstrated motion requirement.

GitHub's standard Ubuntu runner on this public repository has no incremental runner-minute charge. No larger runner, paid API, cache, or artifact upload is configured. Temporary media is deleted in an always-run cleanup step. Existing Canva subscription capacity was used for the isolated design; no account upgrade.

A proposed one-object expiring Supabase upload authorization was rejected by automatic approval review because storing that credential in this public repository's GitHub secrets was not specifically authorized. It was **not executed**. The safer credential-free cloud proof retains only checksums/technical logs; media is not retained in public workflow artifacts. No workaround transferred broad Supabase credentials.

## Release gate

Still required: authorized unattended editorial execution; asset-specific publication basis; successful mobile visual QA; private hosted output persistence; immutable candidate creation and the existing Gmail notification. No candidate, email, approval, outbox or live post was created by this experiment. No Vercel application changes/deployment. Main-Mac-independent rendering alone does not prove the complete newsroom.

## Official references checked

- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/codex/noninteractive/
- https://developers.openai.com/api/docs/pricing
- https://www.canva.dev/docs/apps/rest-apis/reference/autofills/
- https://community.canva.dev/t/autofill-apis-are-now-available-on-canva-pro-and-above/8922
- https://developers.google.com/edge/foresight
- https://developers.google.com/terms/site-policies
- https://www.remotion.dev/docs/ssr
- https://www.remotion.dev/docs/license/pricing
- https://docs.github.com/en/billing/concepts/product-billing/github-actions

## Observed cloud run and verification

- GitHub run: https://github.com/daniel-st3/brainos/actions/runs/37850865874
- Code commit: `19a4c9539e80f4e2d45be4438d8ae691e47aca0f`.
- Standard Ubuntu hosted job succeeded, 22:03:31–22:04:38 UTC (67 seconds total).
- Measured render plus decode/frame checks: 9.2 seconds. FFmpeg 6.1.1-3ubuntu5.
- Output: 582,379 bytes; 1080×1350; 30fps; 23.13 seconds; no audio because the original GIF has none.
- Hosted output SHA-256: `bc76e0d392dc3eb1f4cfea745d2d56bfae9c65261a2ff6f6924b3028cafb0e7b`.
- Full decode, dimensions, source checksum checks passed. Ephemeral files cleanup passed. No media uploaded to public artifacts or production storage.
- Cloud vs local output hashes differ because FFmpeg/font environments differ; no byte-equivalence claim. Each actual output gets its own hash.
- Local lint/typecheck and all 466 unit tests passed. Tampered source was rejected before rendering. Existing CI at starting HEAD passed. CI on the experiment commit is separately observable; do not infer its result from the renderer job.
- No application source, auth, RLS, integrations, scheduler, pilot, approval or publishing code changed; no production/preview promotion.
