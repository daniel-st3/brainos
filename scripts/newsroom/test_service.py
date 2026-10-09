"""Local supervisor tests; never claim hosted work or install a launch agent."""
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("newsroom_service", pathlib.Path(__file__).with_name("service.py"))
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


class ServiceTests(unittest.TestCase):
    def test_private_config_creation_and_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "config.json"
            old = os.umask(0)
            try:
                service.private_write(path, {"worker_token": "test-only"})
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                path.chmod(0o644)
                service.private_write(path, {"worker_token": "replacement"})
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(json.loads(path.read_text())["worker_token"], "replacement")
                self.assertEqual(list(path.parent.iterdir()), [path])
            finally:
                os.umask(old)

    def test_stop_waits_for_child_before_returning(self):
        child = Mock()
        child.poll.return_value = None
        service.stop_child(child)
        child.terminate.assert_called_once()
        child.wait.assert_called_once_with(timeout=20)
        child.kill.assert_not_called()

    def test_hung_child_is_killed_and_reaped(self):
        child = Mock()
        child.poll.return_value = None
        child.wait.side_effect = [subprocess.TimeoutExpired("worker", 20), 0]
        service.stop_child(child)
        child.kill.assert_called_once()
        self.assertEqual(child.wait.call_count, 2)

    def test_exited_child_is_not_signaled(self):
        child = Mock()
        child.poll.return_value = 0
        service.stop_child(child)
        child.terminate.assert_not_called()

    def test_rejects_credential_bearing_or_insecure_origins(self):
        for origin in ["http://example.test", "https://user:secret@example.test", "https://example.test?token=secret", "https://example.test/api"]:
            with self.subTest(origin=origin), self.assertRaises(SystemExit), patch.object(service.subprocess, "run") as run:
                service.preflight({"origin": origin, "worker_token": "test", "node": "/missing", "codex": "/missing"})
                run.assert_not_called()

    def test_api_key_login_is_rejected_without_showing_output(self):
        cfg = {"origin": "https://example.test", "worker_token": "test", "node": "/node", "codex": "/codex"}
        with patch.object(service.os, "access", return_value=True), patch.object(service.subprocess, "run", side_effect=[Mock(stdout="v24.0.0"), Mock(returncode=0, stdout="Logged in with API key sensitive", stderr="")]):
            with self.assertRaises(SystemExit) as raised:
                service.preflight(cfg)
            self.assertNotIn("sensitive", str(raised.exception))
            self.assertIn("ChatGPT", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
