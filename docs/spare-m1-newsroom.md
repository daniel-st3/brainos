# Spare M1: one-time worker handoff

Status: installer and supervisor prepared and tested on the current Mac. The spare is NOT reachable or provisioned yet. No launch agent has been installed on the main Mac. No new creative run is scheduled by this handoff; Gemini feedback is pending.

## Daniel's one-time actions

1. Connect the spare to power and reliable Wi-Fi. Log into a dedicated macOS user that will run BrainOS. Keep the laptop awake, preferably lid open; the display may sleep. Disable automatic system sleep on power using the supported setting for its macOS version. A job-only power assertion prevents idle sleep during processing; it cannot wake a deliberately sleeping/closed laptop. After a reboot/FileVault unlock, this user must log in before the LaunchAgent starts. Screen locking is fine.
2. For installation on the same private network: System Settings → General → Sharing → Remote Login → allow **only that user**. Do not enable full-disk access, router port forwarding or public SSH. Provide the displayed local hostname and username, not a password. Arrange SSH public-key access locally, verifying the host fingerprint. Remote access is for maintenance only; jobs use outbound HTTPS. Off-network access is not configured by this pass; use an approved private VPN later if needed.
3. Install the official Codex CLI and sign into **ChatGPT on the spare itself** using `codex login`. Complete its normal browser flow there (or officially supported `codex login --device-auth` if enabled). Never transfer the main Mac's auth cache or paste credentials in chat. Every inference call rechecks the local authentication mode and rejects API-key login. Subscription capacity is shared; an exhausted allowance or expired/revoked login stops work, with no paid API fallback.

After connectivity and consent, the engineering installation can do the remaining steps. Allow approximately **20–30 minutes** for installation and smoke verification, excluding large dependency downloads or OS updates; then observe a 24-hour idle/recovery soak before calling the machine unattended-production verified.

## Operator installation (on the spare)

- Install native Apple Silicon Node 24 and Python 3. Clone the BrainOS repository and check out the reviewed `codex/automated-newsroom` commit.
- Run `npm ci` **on the spare**, so Sharp and other native dependencies match arm64. Do not copy `node_modules` from another Mac.
- Prepare a private JSON file outside the repo with mode 0600: absolute executable paths `node`, `codex`; staging `origin`; existing scoped `worker_token`; and `bypass` only if that deployment requires it. Supply values through existing secure local secret handling, not chat. Do not install Supabase admin, Gmail, Buffer, or paid inference credentials on the spare.
- Run from the checkout:

```sh
python3 scripts/newsroom/service.py doctor --config /private/path/newsroom.json
python3 scripts/newsroom/service.py install --config /private/path/newsroom.json
python3 scripts/newsroom/service.py start
python3 scripts/newsroom/service.py status
```

The doctor checks ChatGPT authentication, Node, required CLI isolation flags, and native Sharp/tsx rendering without claiming a job. It does not validate the hosted token or subscription/model availability. The measured CLI is `0.162.0-alpha.2`, model `gpt-6.1-sol`, high reasoning. Do not silently use an incompatible CLI; doctor rejects missing isolation features. Record the installed official version on the spare and run a bounded schema-only inference smoke check before processing work.

Install copies runtime code/dependencies into `~/Library/Application Support/BrainOS/newsroom` (0700), stores configuration atomically (0600), and registers `com.brainos.newsroom` as an after-login LaunchAgent. It does not copy Codex credentials. Stop the existing service before reinstalling an update. The service polls every 60 seconds while idle, backs off five minutes on error, uses launchd restart throttling and a singleton lock, and waits for the worker to exit before releasing the lock. The worker inherits the lock descriptor, so a supervisor crash cannot release it while that worker is still alive. Hosted claims retain existing lease fencing and bounded retries. Codex subprocess termination has a five-second kill fallback.

Operations:

```sh
python3 scripts/newsroom/service.py stop
python3 scripts/newsroom/service.py start
python3 scripts/newsroom/service.py status
```

Logs: `~/Library/Application Support/BrainOS/newsroom/service.log` plus one bounded backup. Per-job structured usage and QA remain under `jobs/`. Review unknown/blocked jobs before retrying; do not reset existing completed jobs or generate a new candidate to test startup.

## Acceptance on the spare (still pending)

Verify idle polling, safe stop/start, crash recovery, singleton behavior, native renderer and subscription-only inference. After Daniel's Gemini feedback, run the next authorized staging job end to end and measure all calls. Shut down the main Mac for that test. Verify hosted job completion and the existing review email; no approval or publishing. Reboot and log into the spare to verify automatic startup. Confirm the worker cannot access live provider credentials.

Official references: [Codex authentication](https://developers.openai.com/codex/auth/), [noninteractive execution](https://developers.openai.com/codex/noninteractive/), [Apple Remote Login](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac).
