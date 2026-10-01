"""Local worker lifecycle: singleton, bounded logs, job-only power assertion."""

import fcntl
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
from datetime import datetime, timezone

STOP = threading.Event()
LOG = logging.getLogger("brainos.worker")


def state_dir():
    return Path(
        os.getenv(
            "BRAINOS_WORKER_STATE_DIR",
            str(Path.home() / "Library/Application Support/BrainOS/worker/state"),
        )
    ).expanduser()


def private_dir(p):
    p.mkdir(parents=True, exist_ok=True)
    p.chmod(0o700)
    return p


def write_status(status, **fields):
    root = private_dir(state_dir())
    data = {
        "status": status,
        "pid": os.getpid(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        **fields,
    }
    tmp = root / f"status.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(data, indent=2))
    tmp.chmod(0o600)
    tmp.replace(root / "status.json")


def safe_error(error):
    message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    for k, value in os.environ.items():
        if any(word in k for word in ("TOKEN", "SECRET", "PASSWORD")) and value:
            message = message.replace(value, "[REDACTED]")
    import re

    return re.sub(r"https?://\S+", "[URL REDACTED]", message)[:1500]


def setup_logging():
    if LOG.handlers:
        return
    root = private_dir(state_dir().parent / "logs")
    startup = root / "launchd.log"
    if startup.exists() and startup.stat().st_size > 2_000_000:
        startup.write_text(
            "Older startup diagnostics truncated; see rotated worker logs.\n"
        )
    handler = RotatingFileHandler(
        root / "worker.log", maxBytes=2_000_000, backupCount=3
    )
    (root / "worker.log").chmod(0o600)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    LOG.addHandler(handler)
    LOG.setLevel(logging.INFO)
    LOG.propagate = False


class WorkerLock:
    def __enter__(self):
        self.file = (private_dir(state_dir()) / "worker.lock").open("a+")
        os.chmod(self.file.name, 0o600)
        try:
            fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.file.close()
            raise RuntimeError(
                "A BrainOS worker is already running; use service.py status or stop"
            ) from None
        self.file.seek(0)
        self.file.truncate()
        self.file.write(str(os.getpid()))
        self.file.flush()
        return self

    def __exit__(self, *args):
        fcntl.flock(self.file.fileno(), fcntl.LOCK_UN)
        self.file.close()
        # Never unlink a flock file: waiters could otherwise lock different inodes.


class ActiveJob:
    def __init__(self, job):
        self.job = job
        self.power = None

    def __enter__(self):
        if sys.platform == "darwin":
            self.power = subprocess.Popen(
                ["/usr/bin/caffeinate", "-i", "-w", str(os.getpid())],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        try:
            write_status(
                "processing",
                job_id=self.job["id"],
                kind=self.job["kind"],
                power_pid=self.power.pid if self.power else None,
            )
            LOG.info(
                "job started kind=%s id=%s attempt=%s",
                self.job["kind"],
                self.job["id"],
                self.job.get("attempts"),
            )
        except BaseException:
            self.release_power()
            raise
        return self

    def release_power(self):
        if self.power:
            self.power.terminate()
            try:
                self.power.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.power.kill()
                self.power.wait()

    def __exit__(self, typ, value, tb):
        self.release_power()
        LOG.info(
            "job finished kind=%s id=%s result=%s",
            self.job["kind"],
            self.job["id"],
            "interrupted/error" if typ else "completed",
        )
        write_status(
            "idle",
            last_job_id=self.job["id"],
            last_result="interrupted/error" if typ else "completed",
            power_pid=None,
        )


class WorkerStopping(RuntimeError):
    pass


def handle_stop(signum, frame):
    STOP.set()
    raise WorkerStopping("Worker stopping; interrupted job can be retried")


def watch(process_one):
    setup_logging()
    STOP.clear()
    signal.signal(signal.SIGTERM, handle_stop)
    signal.signal(signal.SIGINT, handle_stop)
    idle = max(10, min(300, int(os.getenv("WORKER_POLL_SECONDS", "60"))))
    errors = 0
    with WorkerLock():
        LOG.info("worker started pid=%s idle_poll=%ss", os.getpid(), idle)
        try:
            while not STOP.is_set():
                try:
                    write_status("polling", power_pid=None)
                    worked = process_one()
                    errors = 0
                    if worked:
                        continue
                    write_status("idle", next_poll_seconds=idle, power_pid=None)
                    STOP.wait(idle)
                except WorkerStopping:
                    break
                except Exception as error:
                    errors += 1
                    delay = min(300, idle * 2 ** min(errors - 1, 5))
                    message = safe_error(error)
                    LOG.warning("worker error; retry in %ss: %s", delay, message)
                    write_status(
                        "backoff",
                        error=message,
                        next_poll_seconds=delay,
                        power_pid=None,
                    )
                    STOP.wait(delay)
        except WorkerStopping:
            pass
        finally:
            write_status("stopped", power_pid=None)
            LOG.info("worker stopped")
