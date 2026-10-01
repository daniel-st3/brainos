# BrainOS production studio

Open `/production/studio` after approving an angle and the exact script revision in the editorial workspace. Discovery and the existing daily scheduler are independent of this workflow.

## Creator workflow

1. Create the recording package. It snapshots the approved script, hook, duration, CTA, shots, B-roll, evidence reminders and checklist. Editing the draft invalidates the package; create a new package after approving the replacement revision.
2. Select 3–10 pieces for a batch. The estimate includes 30 seconds of setup per piece. Export the combined teleprompter and checklist or each piece's package. A linked recording marks a piece recorded.
3. Upload an owned recording (up to 50 MB), link its stable Drive file ID, or register a local file with the worker. The UI records an explicit ownership declaration; it does not clear third-party assets.
4. Queue transcription, run the Mac worker, refresh the studio, and review the timestamped transcript. Prepare and review the deterministic edit suggestions. Pauses and repeated wording are suggestions, not creative decisions. Script token overlap is a review aid, not proof of a faithful recording.
5. Review required asset rights. A cleared asset requires an explicit confirmation, usage basis and file/reference. Optional candidates remain blocked and are not used. Source/quote/stat/comparison cards retain source IDs, links, attribution, story ID and unresolved rights in their SVG metadata.
6. Mark render-ready and queue the local render. Choose original framing or center-cropped 720×1280, optional normalization, pause cuts and caption burn-in. Original files are never edited. B-roll/screenshots are insertion instructions for a human editor; the worker does not composite them.
7. Watch the exported video and download its re-timed captions. Send it to final review and approve the exact production version. Script, media or asset changes invalidate prior output/approval. No action posts to social platforms.

The platform JSON includes short-video materials, X copy and a newsletter section. Text adaptations carry their own `review_required` flags. No automatic translation is performed. Raw/source subtitles retain original timing; rendered subtitles include the cut-to-source timing map.

## Mac worker setup

Use Python 3.12. From the repository:

```sh
python3.12 -m venv .venv-media
.venv-media/bin/pip install -r scripts/media/requirements.lock.txt
cp .env.worker.example .env.worker.local
chmod 600 .env.worker.local
.venv-media/bin/python scripts/media/worker.py doctor
.venv-media/bin/python scripts/media/worker.py watch
```

Set `BRAINOS_URL`, a dedicated random `PRODUCTION_WORKER_TOKEN` shared with the preview runtime, and `MEDIA_INPUT_ROOT` to a directory of recordings. A protected Vercel preview additionally needs `VERCEL_AUTOMATION_BYPASS_SECRET`. These stay in the private env file. Never put Supabase's service key or infrastructure tokens in the worker file. `once` processes one job; `watch` checks every 60 seconds until Ctrl-C and excludes a second local worker using a singleton lock. The Mac must be awake. For login startup and crash recovery, use `scripts/media/service.py install`; see [service operations](../../docs/local-worker-service.md).

Register a local recording without manually copying JSON:

```sh
.venv-media/bin/python scripts/media/worker.py register --package PACKAGE_UUID --file '/absolute/path/inside/MEDIA_INPUT_ROOT/recording.mp4' --owned
```

Uploads go directly to private Supabase storage, bypassing Vercel's request body limit. Drive references point at existing files under the configured root and do not copy originals. Local references are confined to `MEDIA_INPUT_ROOT`, including symlink resolution. Source checksums prevent silently replacing a recording after transcription. Render results upload to private storage; the current free-plan output limit is 50 MB. Larger originals can use Drive/local references (default remote download cap 2 GB).

The default local transcription model is multilingual Whisper `small`, CPU/int8; it downloads on first use. Spanish is the default, with English for English drafts, using transcription rather than translation. No transcription API is required. `WHISPER_MODEL=tiny` is useful for a quick demo, with lower accuracy. ffmpeg supplies mono 16 kHz audio, acoustic silence detection and deterministic exports. The pinned ffmpeg distribution includes libass. Word probabilities are averaged into segment confidence when available. Full processing artifacts stay in `~/.brainos-media/JOB_UUID` unless overridden.

Jobs use authenticated endpoints, exclusive claims, expiring leases, heartbeats, revision fencing and idempotency by package/version/kind. Retries appear in the UI. A stale worker cannot overwrite a changed package or approve final content. Stop the worker and rotate its dedicated token if access needs revocation.

## Hosted setup

Apply the additive `production_studio` migration and run `npm run production:setup` with server-only Supabase settings. This creates the private `brainos-production` bucket and verifies signed upload, metadata, download and anonymous denial. Configure `PRODUCTION_WORKER_TOKEN` only on the intended preview. Vercel is the UI/API control plane; it does not load Python models or transcode video.

For Drive, the existing runtime integration requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DRIVE_ROOT_ID`, `CONTENT_OS_ORIGIN` and a 64-hex-character `INTEGRATION_ENCRYPTION_KEY`. Connector access is separate from app OAuth. Add `${CONTENT_OS_ORIGIN}/api/integrations/google/callback` as the OAuth web client's exact authorized redirect URI. Signed in as Daniel, click **Conectar Drive** at `/production/studio` (or visit `/api/integrations/google/start`) and consent once. Refresh tokens are encrypted in Supabase. Gmail remains disabled. Until the OAuth client exists, Drive is shown as pending rather than presenting a broken consent link.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run db:validate
npm run build
npm run test:e2e
```

`E2E_PORT_BASE=3300` runs browser tests on 3300/3301 when default ports are occupied. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if using an installed Chrome.

`scripts/seed-production-demo.ts` creates three clearly labelled pieces via real angle/script approval commands only in an empty local `production-flow` directory. It refuses connected Supabase mode. The verification fixture used real archival JFK audio from the whisper.cpp sample, with a visibly labelled test video; it is not Daniel and is never seeded into the live newsroom. No synthetic speech is used. See `docs/production-verification.md` for this pass's evidence.

The worker's timing test can also perform a real ffmpeg export against a labelled local fixture:

```sh
BRAINOS_TEST_MEDIA=.data/production-verification/demo-recording.mp4 .venv-media/bin/python scripts/media/test_worker.py
```

Without that file variable, only the pure timing test runs. The real test verifies trim duration, 9:16 dimensions, audio normalization/caption filter execution, caption remapping and unchanged original bytes.
