import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
import runtime
from service import configuration


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"BRAINOS_WORKER_STATE_DIR": self.tmp.name})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_singleton_fences_separate_process_and_recovers(self):
        code = 'from runtime import WorkerLock\nwith WorkerLock(): print("acquired")'
        with runtime.WorkerLock():
            child = subprocess.run(
                [sys.executable, "-c", code],
                cwd=Path(__file__).parent,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(child.returncode, 0)
            self.assertIn("already running", child.stderr)
        child = subprocess.run(
            [sys.executable, "-c", code],
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
        )
        self.assertEqual(child.returncode, 0)

    def test_power_assertion_only_for_job_and_always_released(self):
        power = Mock(pid=999)
        with patch.object(runtime.sys, "platform", "darwin"), patch.object(
            runtime.subprocess, "Popen", return_value=power
        ) as spawn:
            self.assertFalse(spawn.called)
            with self.assertRaises(RuntimeError):
                with runtime.ActiveJob({"id": "fixture", "kind": "transcribe"}):
                    self.assertEqual(
                        json.loads((Path(self.tmp.name) / "status.json").read_text())[
                            "power_pid"
                        ],
                        999,
                    )
                    raise RuntimeError("interrupted")
            self.assertIn("-w", spawn.call_args.args[0])
            power.terminate.assert_called_once()
            self.assertIsNone(
                json.loads((Path(self.tmp.name) / "status.json").read_text())[
                    "power_pid"
                ]
            )

    def test_secret_redaction(self):
        with patch.dict(os.environ, {"PRODUCTION_WORKER_TOKEN": "test-private-value"}):
            result = runtime.safe_error(
                RuntimeError("test-private-value https://example.com/?token=other")
            )
            self.assertNotIn("test-private-value", result)
            self.assertNotIn("token=other", result)

    def test_launchd_config_has_no_secrets_and_restarts_with_backoff(self):
        p = configuration(Path("/test/worker"))
        self.assertTrue(p["RunAtLoad"])
        self.assertTrue(p["KeepAlive"])
        self.assertGreaterEqual(p["ThrottleInterval"], 30)
        self.assertFalse(p["AbandonProcessGroup"])
        self.assertNotIn("PRODUCTION_WORKER_TOKEN", json.dumps(p))
        self.assertNotIn("caffeinate", json.dumps(p))
        self.assertIn("watch", p["ProgramArguments"])

    def test_idle_waits_and_never_asserts_power(self):
        stop = Mock()
        stop.is_set.side_effect = [False, True]
        with patch.object(runtime, "STOP", stop), patch.object(
            runtime, "setup_logging"
        ), patch.object(runtime.signal, "signal"), patch.object(
            runtime.subprocess, "Popen"
        ) as power:
            runtime.watch(lambda: False)
            stop.wait.assert_called_once_with(60)
            power.assert_not_called()

    def test_network_failure_backs_off_without_busy_loop(self):
        stop = Mock()
        stop.is_set.side_effect = [False, False, True]
        with patch.object(runtime, "STOP", stop), patch.object(
            runtime, "setup_logging"
        ), patch.object(runtime.signal, "signal"):
            runtime.watch(Mock(side_effect=RuntimeError("offline")))
            self.assertEqual([a.args[0] for a in stop.wait.call_args_list], [60, 120])

    def test_stop_waits_for_old_launchd_instance_before_returning(self):
        import service

        result = Mock(returncode=0, stdout="pid = 12345\n")
        with patch.object(service, "launch", return_value=result), patch.object(
            service, "loaded", side_effect=[True, False]
        ), patch.object(
            service.os, "kill", side_effect=[None, ProcessLookupError]
        ), patch.object(
            service.time, "sleep"
        ) as wait:
            service.stop()
            wait.assert_called_once_with(0.1)

    def test_power_cleanup_when_job_status_write_fails(self):
        power = Mock(pid=999)
        with patch.object(runtime.sys, "platform", "darwin"), patch.object(
            runtime.subprocess, "Popen", return_value=power
        ), patch.object(
            runtime, "write_status", side_effect=OSError("disk unavailable")
        ):
            with self.assertRaises(OSError):
                with runtime.ActiveJob({"id": "fixture", "kind": "render"}):
                    pass
            power.terminate.assert_called_once()


if __name__ == "__main__":
    unittest.main()
