"""Timing and real ffmpeg boundary checks; uses an existing demo MP4."""

import json, os, tempfile, unittest
from pathlib import Path
from worker import remap_segments, render, sha, probe, validate_final_video


class WorkerTests(unittest.TestCase):
    def test_caption_mapping_preserves_source_gaps(self):
        segments = [
            {"start": 1, "end": 2, "text": "Uno."},
            {"start": 7, "end": 9, "text": "Dos."},
        ]
        keep = [{"start": 0, "end": 3}, {"start": 6, "end": 10}]
        self.assertEqual(
            remap_segments(segments, keep),
            [
                {"start": 1, "end": 2, "text": "Uno."},
                {"start": 4, "end": 6, "text": "Dos."},
            ],
        )

    @unittest.skipUnless(
        os.getenv("BRAINOS_TEST_MEDIA"),
        "Set BRAINOS_TEST_MEDIA to the labelled demo MP4 for a real ffmpeg test",
    )
    def test_real_trim_vertical_normalize_and_captions(self):
        source = Path(os.environ["BRAINOS_TEST_MEDIA"]).resolve()
        original = sha(source)
        spec = {
            "options": {
                "remove_pauses": True,
                "layout": "vertical",
                "normalize": True,
                "burn_subtitles": True,
            },
            "transcript": {
                "media_id": "demo-only",
                "segments": [
                    {"start": 0.3, "end": 1.5, "text": "DEMO: prueba de subtítulos."},
                    {"start": 7, "end": 8, "text": "Segundo segmento."},
                ],
            },
            "plan": {"keep": [{"start": 0, "end": 2}, {"start": 6, "end": 9}]},
        }
        with tempfile.TemporaryDirectory(prefix="brainos-render-test-") as tmp:
            output, duration, captions = render(source, spec, Path(tmp))
            final=validate_final_video(output)
            self.assertEqual(final["codec"],"h264")
            self.assertEqual((final["width"],final["height"]),(720,1280))
            self.assertEqual(final["bytes"],output.stat().st_size)
            self.assertAlmostEqual(duration, 5, delta=0.2)
            self.assertNotEqual(sha(output), original)
            self.assertEqual(sha(source), original)
            import av

            with av.open(str(output)) as video:
                self.assertEqual(
                    (video.streams.video[0].width, video.streams.video[0].height),
                    (720, 1280),
                )
            self.assertIn("00:00:03,000 --> 00:00:04,000", captions["srt"])
            self.assertTrue(captions["vtt"].startswith("WEBVTT"))
            self.assertEqual(
                json.loads(captions["json"])["source_timing_map"], spec["plan"]["keep"]
            )


if __name__ == "__main__":
    unittest.main()
