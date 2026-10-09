"""Spare-Mac supervisor: outbound HTTPS only; each Mac authenticates Codex itself."""
import argparse
import fcntl
import json
import os
import pathlib
import plistlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path.home() / "Library/Application Support/BrainOS/newsroom"
LABEL = "com.brainos.newsroom"
PLIST = pathlib.Path.home() / f"Library/LaunchAgents/{LABEL}.plist"


def private_write(path, value):
    """Never briefly expose worker credentials with permissive creation modes."""
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".config-")
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(value, handle)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def preflight(cfg):
    from urllib.parse import urlparse
    for key in ["node", "codex", "origin", "worker_token"]:
        if not cfg.get(key):
            raise SystemExit("Missing config field: " + key)
    origin = urlparse(cfg["origin"])
    if origin.scheme != "https" or not origin.hostname or origin.username or origin.password or origin.query or origin.fragment or origin.path not in ("", "/"):
        raise SystemExit("An exact HTTPS application origin is required")
    for key in ["node", "codex"]:
        binary = pathlib.Path(cfg[key])
        if not binary.is_absolute() or not os.access(binary, os.X_OK):
            raise SystemExit("Missing absolute executable: " + key)
    if cfg.get("ffmpeg"):
        binary = pathlib.Path(cfg["ffmpeg"])
        if not binary.is_absolute() or not os.access(binary, os.X_OK):
            raise SystemExit("Missing absolute executable: ffmpeg")
    node = subprocess.run([cfg["node"], "--version"], capture_output=True, text=True, check=True)
    if int(node.stdout.strip().lstrip("v").split(".")[0]) < 24:
        raise SystemExit("Node 24 or newer required")
    login = subprocess.run([cfg["codex"], "login", "status"], capture_output=True, text=True)
    if login.returncode or "ChatGPT" not in login.stdout + login.stderr:
        raise SystemExit("Run codex login on this Mac using ChatGPT first; do not copy another Mac's auth")
    help_text = subprocess.run([cfg["codex"], "exec", "--help"], capture_output=True, text=True, check=True).stdout
    for flag in ["--ignore-user-config", "--ignore-rules", "--ephemeral", "--output-schema"]:
        if flag not in help_text:
            raise SystemExit("Installed official Codex CLI lacks required flag: " + flag)
    # Older official CLI releases can lack isolation flags. Fail rather than silently broaden access.
    features = subprocess.run([cfg["codex"], "features", "list"], capture_output=True, text=True, check=True).stdout
    names = {line.split()[0] for line in features.splitlines() if line.split()}
    if not {"shell_tool", "apps", "browser_use", "computer_use", "plugins", "hooks", "memories"}.issubset(names):
        raise SystemExit("Installed CLI lacks worker isolation features; use a compatible official release")
    return node.stdout.strip()


def stop_child(child):
    if child is None or child.poll() is not None:
        return
    child.terminate()
    try:
        # Worker forwards termination to Codex, stops its power assertion and closes leases.
        child.wait(timeout=20)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["install", "doctor", "start", "stop", "status", "run"])
    parser.add_argument("--config")
    args = parser.parse_args()
    target = f"gui/{os.getuid()}"
    if args.action in ["install", "doctor"]:
        config_path = pathlib.Path(args.config) if args.config else ROOT / "config.json"
        cfg = json.loads(config_path.read_text())
        node_version = preflight(cfg)
        repo = pathlib.Path(__file__).resolve().parents[2]
        # Validate native Sharp/tsx on this machine, not copied x86 dependencies from another Mac.
        subprocess.run([cfg["node"], "--input-type=module", "-e", "await import('tsx'); const {default:s}=await import('sharp'); await s({create:{width:1,height:1,channels:3,background:'white'}}).png().toBuffer();"], cwd=repo, check=True, capture_output=True)
        if args.action == "doctor":
            print(f"PASS: {node_version}, ChatGPT login, CLI isolation flags, local Sharp/tsx. No job claimed.")
            return
        running = subprocess.run(["launchctl", "print", target + "/" + LABEL], capture_output=True)
        if running.returncode == 0:
            raise SystemExit("Stop the existing service before installing an update")
        ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
        ROOT.chmod(0o700)
        for folder in ["src", "scripts/newsroom", "node_modules"]:
            shutil.copytree(repo / folder, ROOT / folder, dirs_exist_ok=True, symlinks=False, ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copy2(repo / "package.json", ROOT / "package.json")
        private_write(ROOT / "config.json", cfg)
        PLIST.parent.mkdir(parents=True, exist_ok=True)
        PLIST.write_bytes(plistlib.dumps({"Label": LABEL, "ProgramArguments": [sys.executable, str(ROOT / "scripts/newsroom/service.py"), "run"], "WorkingDirectory": str(ROOT), "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 60, "ExitTimeOut": 30, "StandardOutPath": str(ROOT / "service.log"), "StandardErrorPath": str(ROOT / "service.log")}))
        print("Installed. Start with service.py start; keep the spare awake and powered.")
        return
    if args.action == "start":
        if subprocess.run(["launchctl", "print", target + "/" + LABEL], capture_output=True).returncode == 0:
            print("Already running; no second supervisor started.")
            return
        subprocess.run(["launchctl", "bootstrap", target, str(PLIST)], check=True)
        return
    if args.action in ["stop", "status"]:
        subprocess.run(["launchctl", "bootout" if args.action == "stop" else "print", target + "/" + LABEL], check=False)
        return
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(ROOT / "worker.lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("Worker already running")
        cfg = json.loads((ROOT / "config.json").read_text())
        env = {k: v for k, v in os.environ.items() if k in ["HOME", "PATH", "TMPDIR", "LANG"]}
        env.update({"BRAINOS_ORIGIN": cfg["origin"], "PRODUCTION_WORKER_TOKEN": cfg["worker_token"], "NEWSROOM_CODEX_BIN": cfg["codex"], "NEWSROOM_WORK_DIR": str(ROOT / "jobs")})
        if cfg.get("ffmpeg"):
            env["FFMPEG_BIN"] = cfg["ffmpeg"]
        if cfg.get("bypass"):
            env["VERCEL_AUTOMATION_BYPASS_SECRET"] = cfg["bypass"]
        child = None
        def stop(*_):
            stop_child(child)  # Retain singleton lock until the child has exited.
            raise SystemExit(0)
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        while True:
            child = subprocess.Popen([cfg["node"], "--import", "./node_modules/tsx/dist/loader.mjs", "scripts/newsroom/worker.mjs"], cwd=ROOT, env=env, pass_fds=(lock.fileno(),))
            code = child.wait()
            print(json.dumps({"at": time.time(), "worker_exit": code}), flush=True)
            log = ROOT / "service.log"
            if log.exists() and log.stat().st_size > 2_000_000:
                shutil.copy2(log, ROOT / "service.previous.log")
                log.write_text("")  # Keep launchd's open inode; retain one bounded backup.
            time.sleep(60 if code == 0 else 300)


if __name__ == "__main__":
    main()
