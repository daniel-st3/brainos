#!/usr/bin/env python3
"""Install/control BrainOS's per-user macOS launchd worker; never stores secrets in its plist."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import time
import re
from runtime import private_dir

LABEL = "com.brainos.media-worker"
ROOT = Path.home() / "Library/Application Support/BrainOS/worker"
PLIST = Path.home() / "Library/LaunchAgents" / (LABEL + ".plist")
DOMAIN = f"gui/{os.getuid()}"
TARGET = DOMAIN + "/" + LABEL


def launch(*args, check=True):
    result = subprocess.run(["/bin/launchctl", *args], capture_output=True, text=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or "launchctl operation failed")
    return result


def configuration(root=ROOT):
    return {
        "Label": LABEL,
        "ProgramArguments": [
            str(root / "venv/bin/python"),
            "-u",
            str(root / "worker.py"),
            "--env",
            str(root / "worker.env"),
            "watch",
        ],
        "WorkingDirectory": str(root),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 30,
        "ExitTimeOut": 30,
        "ProcessType": "Background",
        "LowPriorityIO": True,
        "Nice": 5,
        "Umask": 0o077,
        "AbandonProcessGroup": False,
        "EnvironmentVariables": {
            "BRAINOS_WORKER_STATE_DIR": str(root / "state"),
            "PYTHONUNBUFFERED": "1",
        },
        "StandardOutPath": str(root / "logs/launchd.log"),
        "StandardErrorPath": str(root / "logs/launchd.log"),
    }


def loaded():
    return launch("print", TARGET, check=False).returncode == 0


def start():
    if not PLIST.exists():
        raise RuntimeError("Install the service first")
    launch("enable", TARGET)
    if not loaded():
        launch("bootstrap", DOMAIN, str(PLIST))
    print("BrainOS worker enabled at login and started.")


def stop():
    launch("disable", TARGET)
    prior = launch("print", TARGET, check=False)
    match = re.search(r"^\s*pid = (\d+)$", prior.stdout, re.MULTILINE)
    pid = int(match.group(1)) if match else None
    if prior.returncode == 0:
        launch("bootout", TARGET)
    # bootout can return while the old process is still unregistering. Waiting
    # prevents start() from mistaking that exiting instance for the new service.
    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        alive = False
        if pid:
            try:
                os.kill(pid, 0)
                alive = True
            except ProcessLookupError:
                pass
        if not loaded() and not alive:
            break
        time.sleep(0.1)
    else:
        raise RuntimeError(
            "Worker did not finish stopping; inspect status before restarting"
        )
    print("BrainOS worker stopped and disabled at login until start.")


def install(env):
    if not env.is_file():
        raise RuntimeError("Private worker environment file missing")
    values = {
        k: v.strip()
        for l in env.read_text().splitlines()
        if "=" in l and not l.lstrip().startswith("#")
        for k, v in [l.split("=", 1)]
    }
    if len(values.get("PRODUCTION_WORKER_TOKEN", "")) < 32 or not values.get(
        "BRAINOS_URL"
    ):
        raise RuntimeError(
            "Configure the preview URL and scoped worker token before installation"
        )
    if loaded():
        stop()
    source = Path(__file__).resolve().parent
    private_dir(ROOT)
    private_dir(ROOT / "logs")
    private_dir(ROOT / "state")
    # Python/code outside Documents avoids macOS background-access prompts there.
    lock = source / "requirements.lock.txt"
    expected = hashlib.sha256(lock.read_bytes()).hexdigest()
    marker = ROOT / "dependencies.sha256"
    if not (ROOT / "venv/bin/python").exists():
        subprocess.run(
            [sys._base_executable, "-m", "venv", str(ROOT / "venv")], check=True
        )
    if not marker.exists() or marker.read_text() != expected:
        subprocess.run(
            [
                str(ROOT / "venv/bin/python"),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--quiet",
                "-r",
                str(lock),
            ],
            check=True,
        )
        marker.write_text(expected)
    for name in ["worker.py", "runtime.py", "requirements.lock.txt"]:
        shutil.copy2(source / name, ROOT / name)
    if env.resolve() != (ROOT / "worker.env").resolve():
        shutil.copyfile(env, ROOT / "worker.env")
    (ROOT / "worker.env").chmod(0o600)
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    PLIST.write_bytes(plistlib.dumps(configuration()))
    PLIST.chmod(0o600)
    subprocess.run(["/usr/bin/plutil", "-lint", str(PLIST)], check=True)
    start()


def status():
    result = launch("print", TARGET, check=False)
    report = {
        "label": LABEL,
        "loaded": result.returncode == 0,
        "plist": str(PLIST),
        "logs": str(ROOT / "logs/worker.log"),
    }
    if result.returncode == 0:
        for line in result.stdout.splitlines():
            key, sep, value = line.strip().partition(" = ")
            if key in ("state", "pid", "last exit code") and sep:
                report[key] = value
    status_file = ROOT / "state/status.json"
    if status_file.exists():
        report["last_worker_observation"] = json.loads(status_file.read_text())
    print(json.dumps(report, indent=2))


def main():
    if sys.platform != "darwin":
        raise RuntimeError("This service controller requires macOS")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", choices=["install", "start", "stop", "restart", "status", "logs"]
    )
    parser.add_argument("--env", type=Path, default=Path(".env.worker.local"))
    args = parser.parse_args()
    if args.command == "install":
        install(args.env)
    elif args.command == "start":
        start()
    elif args.command == "stop":
        stop()
    elif args.command == "restart":
        stop()
        start()
    elif args.command == "status":
        status()
    else:
        log = ROOT / "logs/worker.log"
        print(
            "\n".join(log.read_text().splitlines()[-60:])
            if log.exists()
            else "No worker log yet"
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
