# BrainOS Mac worker operations

The installed per-user LaunchAgent is `com.brainos.media-worker`. It runs after Daniel logs in, without Terminal or Codex staying open. It does not run at the login screen or wake a closed/sleeping Mac to look for jobs.

## Commands (from the BrainOS repository)

```sh
.venv-media/bin/python scripts/media/service.py status
.venv-media/bin/python scripts/media/service.py logs
.venv-media/bin/python scripts/media/service.py stop
.venv-media/bin/python scripts/media/service.py start
.venv-media/bin/python scripts/media/service.py restart
```

`stop` unloads the service and disables automatic login startup until `start`. `restart` stops the current worker and starts it again. A launchd throttle can delay a rapid restart by up to 30 seconds. `status` reports launchd state separately from the timestamped last worker observation, which may briefly belong to the previous process.

To install or update after pulling worker changes:

```sh
.venv-media/bin/python scripts/media/service.py install
```

Installation copies the runtime out of Documents into `~/Library/Application Support/BrainOS/worker/`, installs the pinned Python dependencies there and copies the private `.env.worker.local` configuration. It does not link the service to a terminal session or depend on the repository's active branch. Run `install` again to apply later code/config changes. The plist contains no credentials.

## Files

- LaunchAgent: `~/Library/LaunchAgents/com.brainos.media-worker.plist`
- Private config: `~/Library/Application Support/BrainOS/worker/worker.env` (0600)
- Worker log: `~/Library/Application Support/BrainOS/worker/logs/worker.log` (2 MB, three backups)
- Startup diagnostics: `~/Library/Application Support/BrainOS/worker/logs/launchd.log`
- Timestamped status and singleton lock: `~/Library/Application Support/BrainOS/worker/state/`
- Local recordings: `~/Movies/BrainOS/`
- Processing artifacts: `~/.brainos-media/JOB_UUID/`

The worker credential is scoped to production-job endpoints. The Vercel protection bypass is stored only in the private config. No infrastructure token or Supabase service key is installed in the service.

## Runtime behavior

- Polls the hosted queue every 60 seconds while idle using an interruptible wait. No ffmpeg process, model load or power assertion exists while idle. Network failures back off to a maximum of five minutes and are logged without credentials or signed URLs.
- A local `flock` prevents the service and a manual `watch`/`once` process from running concurrently. Registration remains available while the worker is running. Database job claims, idempotency and revision fencing provide a second boundary across machines.
- `caffeinate -i -w WORKER_PID` exists only while a claimed job is being processed. It is terminated on completion/failure; the PID watch releases it after a crash. It does not force the display on or prevent deliberate sleep/lid closure.
- launchd restarts the worker after unexpected exits, with a 30-second throttle. Child processes remain in launchd's managed process group. A crashed active job becomes claimable when its existing ten-minute lease expires. Maximum automatic attempts remain three; the studio exposes explicit retry afterward.
- Stopping during a job attempts to mark it failed and releases the power assertion. If the API is unreachable, its lease expires naturally. Original media and completed version history are preserved. Do not restart during a long render unless interruption is intended.
- The default Whisper model is multilingual `small`; its initial download occurs when processing the first transcription. The service verification used `tiny` against a clearly labelled archival demo, then restored `small` and the live preview settings.

## Verified on this Mac

The actual installed LaunchAgent automatically claimed a queued transcription from the isolated local BrainOS verification database. No manual `watch` process was used. The transcript persisted, a live caffeinate child was observed during processing, and no assertion remained afterward. The configuration was restored to the hosted preview after the test. A separate idle crash/restart test verifies launchd recovery. No demo editorial records were inserted into the live newsroom.

## First real piece

1. Open the preview and choose the story. Confirm evidence and approve the angle.
2. Review and approve the exact script revision; create its recording package.
3. Record Daniel's own material. Upload directly, or put the file under `~/Movies/BrainOS/` and use the studio's registration command. Drive needs the separate OAuth setup first.
4. Queue transcription. Within the idle polling interval, the background worker picks it up. Refresh the studio to see completion; inspect the transcript before confirming it.
5. Generate and review the edit plan and source-timed subtitle files. Resolve every required asset's rights and usage basis.
6. Mark render-ready, choose deterministic options, and queue rendering. Watch the complete returned MP4, inspect the re-timed captions, and submit it to final review.
7. Daniel approves the exact production version and output checksum. A script revision or asset/media change requires fresh review. Nothing is posted externally.

Use the service log and job error in the studio to diagnose failures. Do not manually reset leases or edit production JSON. If the Mac is asleep, queued jobs wait until it wakes.
