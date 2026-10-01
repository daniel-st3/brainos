# Production slice verification — 2026-10-01

Baseline: `dd6b8b5e1b23fb6c2ee39c36c0546c9cd4eec9a0`, branch `codex/automated-newsroom`.

## Scope and isolation

The local production fixture uses its own PGlite database, `.data/production-flow`. Three clearly labelled demo stories went through the existing `approve_angle` and `approve` commands before recording packages were created. The speech is an archival JFK test sample from the [whisper.cpp repository](https://github.com/ggml-org/whisper.cpp/blob/master/samples/jfk.wav), not Daniel, and not synthetic speech. The video is a labelled test background. Demo approvals are test assertions, not Daniel's approval of real content. No demo records were inserted into the live newsroom.

The local fixture and private worker environment are gitignored. Nothing is published. No feeds, ranking, scoring, deduplication, Morning Brief selection, pilot settings, scheduler workflow or editorial guardrails were changed.

## Executed end-to-end flow

- Approved angle → approved script → immutable recording package for the exact draft revision.
- Three-piece batch with teleprompter sequence, combined checklist, per-piece exports and recorded status.
- Actual local MP4 intake through the scoped worker API; story/draft IDs, filename, MIME, size, duration and checksum persisted.
- A queued transcription job processed by local faster-whisper `tiny` on CPU. Real speech segments and confidence returned to the API. An initial decoder compatibility failure was retained in the test work artifacts, fixed through PCM preprocessing, and successfully retried. The default creator model remains multilingual `small`.
- Human-review test actions → deterministic edit plan → render-ready.
- Actual ffmpeg export with vertical crop, audio normalization, pause-plan application and subtitle burn-in.
- Private local output downloaded through the studio API: 720×1280 H.264/AAC MP4, 11.1 seconds. Its SHA-256 matched final approval. The original media SHA-256 stayed unchanged.
- A second real ffmpeg boundary test retained source intervals 0–2 and 6–9 seconds, producing approximately five seconds of video. The cue at 7–8 seconds moved to 3–4 seconds. The original was unchanged.
- SRT, VTT and JSON source and rendered timelines exported. Render JSON retains the source timing map.
- A source card was stored and downloaded through the API; rights remained unknown and publishability false. Unit tests exercise all four card types and reject invented quotations/statistics.
- Final review and approval persisted against the exact production version and output checksum in the isolated demo database.

## Automated and browser checks

- 88 unit/integration tests pass, including 15 new production cases; all existing tests preserved.
- Seven existing Playwright browser tests pass (editorial, live discovery, pilot, mobile and access controls).
- Two Python worker tests pass, including real ffmpeg execution.
- ESLint, TypeScript, database migration validation and optimized Next.js build pass.
- Production studio opened in Chrome at desktop and 390 px mobile widths: no uncaught page errors and no horizontal document overflow. The rendered output played in the review element.
- The dedicated remote BrainOS project has the additive production migration and 29 RLS-enabled public tables. New RPCs reject anonymous access. The private production bucket passed signed upload, metadata verification, authorized download and anonymous denial; its verification object was removed.

## Limits

Drive's provider boundary is implemented but its OAuth client credentials and owner consent are still needed to verify a real Drive recording. Upload/local paths are independent. Heavy work runs only while the Mac worker is running and awake. The hosted runtime is a lightweight control plane. Outputs above 50 MB remain local and return a clear upload-limit error. B-roll and graphics are instructions/assets for human editing, not automatic compositing. No translation, avatar, generated voice, cloud rendering subscription or auto-posting was added.
