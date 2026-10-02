#!/usr/bin/env python3
"""BrainOS local media worker. Originals are read-only; no social publishing."""
import argparse, base64, hashlib, json, mimetypes, os, re, subprocess, sys, threading, time, urllib.request, urllib.error, uuid, shutil
from pathlib import Path
from datetime import datetime, timezone
from runtime import ActiveJob, WorkerLock, watch, setup_logging, safe_error, LOG


def read_env(filename):
    p = Path(filename)
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


def ffmpeg():
    if os.getenv("FFMPEG_PATH"):
        return os.environ["FFMPEG_PATH"]
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def run(args, timeout=7200):
    r = subprocess.run(
        [ffmpeg(), "-nostdin", "-hide_banner", "-y", *map(str, args)],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if r.returncode:
        raise RuntimeError("ffmpeg failed: " + r.stderr[-1200:])
    return r.stderr


def probe(file):
    import av

    with av.open(str(file)) as c:
        duration = (
            float(c.duration / av.time_base)
            if c.duration
            else max(float(s.duration * s.time_base) for s in c.streams if s.duration)
        )
        if not 0 < duration <= 14400:
            raise RuntimeError("Recording must be between 0 and 4 hours")
        return duration, bool(c.streams.video), bool(c.streams.audio)


def sha(file):
    h = hashlib.sha256()
    with file.open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def validate_final_video(file):
    executable = os.getenv("FFPROBE_PATH") or shutil.which("ffprobe")
    if executable:
        info = json.loads(subprocess.check_output([executable, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(file)], timeout=30))
        video = next(s for s in info["streams"] if s["codec_type"] == "video")
        result = {"width": video["width"], "height": video["height"], "codec": video["codec_name"], "container": info["format"]["format_name"], "duration": float(info["format"]["duration"]), "bytes": int(info["format"]["size"]), "method": "ffprobe"}
    else:
        import av
        with av.open(str(file)) as container:
            video = container.streams.video[0]
            result = {"width": video.width, "height": video.height, "codec": video.codec_context.name, "container": container.format.name, "duration": float(container.duration / av.time_base), "bytes": file.stat().st_size, "method": "pyav-libavformat"}
    if result["codec"] != "h264" or "mp4" not in result["container"] or result["bytes"] <= 0:
        raise RuntimeError("Final output must be a valid H264 MP4")
    return result


def local_file(value):
    root = (
        Path(os.environ.get("MEDIA_INPUT_ROOT", str(Path.home() / "Movies/BrainOS")))
        .expanduser()
        .resolve()
    )
    f = Path(value).expanduser()
    f = (f if f.is_absolute() else root / f).resolve()
    if not f.is_relative_to(root) or not f.is_file():
        raise RuntimeError(
            "Local recording must be an existing file inside MEDIA_INPUT_ROOT"
        )
    return f


def api(payload):
    origin = os.environ["BRAINOS_URL"].rstrip("/")
    u = urllib.parse.urlparse(origin)
    if u.scheme != "https" and not (
        u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1")
    ):
        raise RuntimeError("Use HTTPS or localhost for BrainOS")
    headers = {
        "Content-Type": "application/json",
        "x-brainos-worker-token": os.environ["PRODUCTION_WORKER_TOKEN"],
    }
    if os.getenv("VERCEL_AUTOMATION_BYPASS_SECRET"):
        headers["x-vercel-protection-bypass"] = os.environ[
            "VERCEL_AUTOMATION_BYPASS_SECRET"
        ]
    req = urllib.request.Request(
        origin + "/api/production/worker",
        data=json.dumps(payload).encode(),
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            message = json.loads(e.read()).get("error", "Request rejected")
        except Exception:
            message = "Request rejected"
        raise RuntimeError(f"BrainOS {e.code}: {message}") from None


class Lease:
    def __init__(self, job):
        self.args = {"job_id": job["id"], "lease_token": job["lease_token"]}
        self.stop = threading.Event()
        self.error = None

    def __enter__(self):
        def beat():
            while not self.stop.wait(30):
                try:
                    api({"action": "heartbeat", **self.args, **worker_identity()})
                except Exception as e:
                    self.error = e
                    return

        self.thread = threading.Thread(target=beat, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.stop.set()
        self.thread.join(timeout=2)

    def check(self):
        if self.error:
            raise RuntimeError(
                "Worker lease could not be renewed; result was not committed"
            )


def obtain(source, work):
    if source["provider"] == "local":
        return local_file(source["file"])
    u = urllib.parse.urlparse(source["url"])
    if u.scheme != "https" or not (
        u.hostname == "www.googleapis.com"
        or u.hostname.endswith(".supabase.co")
        or u.hostname.endswith(".storage.supabase.co")
    ):
        raise RuntimeError("Untrusted media download host")
    dest = work / "original.media"
    limit = int(os.getenv("MEDIA_MAX_BYTES", "2000000000"))
    total = 0
    req = urllib.request.Request(source["url"], headers=source.get("headers", {}))
    with urllib.request.urlopen(req, timeout=120) as r, dest.open("wb") as f:
        while b := r.read(1024 * 1024):
            total += len(b)
            if total > limit:
                raise RuntimeError("Media exceeds local download limit")
            f.write(b)
    return dest


def transcribe(file, media_id, language, work):
    from faster_whisper import WhisperModel

    duration, video, audio = probe(file)
    if not audio:
        raise RuntimeError("Recording has no audio track")
    wav = work / "audio-16k.wav"
    run(["-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav])
    logs = run(["-i", wav, "-af", "silencedetect=noise=-35dB:d=0.8", "-f", "null", "-"])
    silences = []
    start = None
    for line in logs.splitlines():
        m = re.search(r"silence_start: ([0-9.]+)", line)
        if m:
            start = float(m.group(1))
        m = re.search(r"silence_end: ([0-9.]+)", line)
        if m and start is not None:
            silences.append({"start": start, "end": min(duration, float(m.group(1)))})
            start = None
    model_name = os.getenv("WHISPER_MODEL", "small")
    model = WhisperModel(
        model_name,
        device="cpu",
        compute_type="int8",
        download_root=os.getenv("WHISPER_CACHE_DIR"),
    )
    import wave, numpy as np

    with wave.open(str(wav), "rb") as w:
        samples = (
            np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(
                np.float32
            )
            / 32768.0
        )
    segments, info = model.transcribe(
        samples,
        language=language,
        task="transcribe",
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
    )
    result = []
    previous = 0
    for s in segments:
        text = s.text.strip()
        start = max(previous, float(s.start))
        end = min(duration, float(s.end))
        if text and end > start:
            confidence = (
                sum(w.probability for w in s.words) / len(s.words) if s.words else None
            )
            item = {"start": start, "end": end, "text": text}
            if confidence is not None:
                item["confidence"] = max(0, min(1, confidence))
            result.append(item)
            previous = end
    if not result:
        raise RuntimeError("No speech detected; inspect the recording before retrying")
    return {
        "language": language,
        "provider": "faster-whisper/" + model_name,
        "media_id": media_id,
        "media_sha256": sha(file),
        "duration": duration,
        "segments": result,
        "silences": silences,
    }


def timestamp(seconds):
    ms = round(seconds * 1000)
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def remap_segments(segments, keep):
    result = []
    offset = 0
    for k in keep:
        for s in segments:
            a = max(s["start"], k["start"])
            b = min(s["end"], k["end"])
            if b > a:
                result.append(
                    {
                        "start": offset + a - k["start"],
                        "end": offset + b - k["start"],
                        "text": s["text"],
                    }
                )
        offset += k["end"] - k["start"]
    return result


def render(file, spec, work):
    duration, video, audio = probe(file)
    if not video or not audio:
        raise RuntimeError("Rendering requires a video with an audio track")
    options = spec["options"]
    source = file
    segments = spec["transcript"]["segments"]
    if options["remove_pauses"]:
        keep = spec["plan"]["keep"]
        filters = []
        if not keep:
            raise RuntimeError("Edit plan has no retained regions")
        for i, k in enumerate(keep):
            if not 0 <= k["start"] < k["end"] <= duration + 0.1:
                raise RuntimeError("Cut interval exceeds original media")
            filters.extend(
                [
                    f"[0:v:0]trim=start={k['start']}:end={k['end']},setpts=PTS-STARTPTS[v{i}]",
                    f"[0:a:0]atrim=start={k['start']}:end={k['end']},asetpts=PTS-STARTPTS[a{i}]",
                ]
            )
        filters.append(
            "".join(f"[v{i}][a{i}]" for i in range(len(keep)))
            + f"concat=n={len(keep)}:v=1:a=1[v][a]"
        )
        script = work / "trim-filters.txt"
        script.write_text(";\n".join(filters))
        source = work / "rough-cut.mp4"
        run(
            [
                "-i",
                file,
                "-filter_complex_script",
                script,
                "-map",
                "[v]",
                "-map",
                "[a]",
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "23",
                "-c:a",
                "aac",
                source,
            ]
        )
        segments = remap_segments(segments, keep)
    srt = work / "render.srt"
    srt.write_text(
        "\n\n".join(
            f"{i+1}\n{timestamp(s['start'])} --> {timestamp(s['end'])}\n{re.sub('<[^>]*>','',s['text']).replace('-->','→')}"
            for i, s in enumerate(segments)
        )
    )
    vf = []
    if options["layout"] == "vertical":
        vf.append(
            "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1"
        )
    if options["burn_subtitles"]:
        # Generated path, never a source-supplied filter. ffmpeg must include libass.
        escaped = str(srt).replace("\\", "/").replace(":", "\\:").replace("'", "'\\''")
        vf.append(f"subtitles=filename='{escaped}'")
    output = work / "render.mp4"
    args = ["-i", source, "-map", "0:v:0", "-map", "0:a:0"]
    if vf:
        args += ["-vf", ",".join(vf)]
    if options["normalize"]:
        args += ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]
    args += [
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        output,
    ]
    run(args)
    actual, _, _ = probe(output)
    captions = {
        "srt": srt.read_text(),
        "vtt": "WEBVTT\n\n"
        + "\n\n".join(
            f"{timestamp(s['start']).replace(',','.')} --> {timestamp(s['end']).replace(',','.')}\n{s['text']}"
            for s in segments
        ),
        "json": json.dumps(
            {
                "segments": segments,
                "timeline": "render",
                "source_media_id": spec["transcript"]["media_id"],
                "source_timing_map": (
                    spec["plan"]["keep"]
                    if options["remove_pauses"]
                    else [{"start": 0, "end": duration}]
                ),
            },
            ensure_ascii=False,
        ),
    }
    for ext, text in captions.items():
        (work / ("render." + ext)).write_text(text)
    return output, actual, captions


def worker_identity():
    return {"protocol": 1, "worker_id": os.getenv("BRAINOS_WORKER_ID", "daniel-mac"), "worker_version": "media-worker/1.2"}


def process_one():
    data = api({"action": "claim", **worker_identity()})
    if not data["job"]:
        return False
    job = data["job"]
    work = (
        Path(os.getenv("MEDIA_WORK_DIR", str(Path.home() / ".brainos-media")))
        / job["id"]
    )
    work.mkdir(parents=True, exist_ok=True)
    os.chmod(work, 0o700)
    try:
        with ActiveJob(job), Lease(job) as lease:
            file = obtain(data["source"], work)
            original_hash = sha(file)
            p = data["package"]
            media = next(
                m for m in p["data"]["media"] if m["id"] == job["input"]["media_id"]
            )
            if media.get("sha256") and media["sha256"] != original_hash:
                raise RuntimeError(
                    "Original media content changed; intake a new recording"
                )
            if job["kind"] == "transcribe":
                language = (
                    "en"
                    if p["data"]["packet"].get("language", "es").startswith("en")
                    else "es"
                )
                result = transcribe(file, media["id"], language, work)
            else:
                output, duration, captions = render(file, data["render"], work)
                size = output.stat().st_size
                if size > 50000000:
                    raise RuntimeError(
                        "Render exceeds 50 MB private upload limit; output retained locally"
                    )
                if (
                    urllib.parse.urlparse(os.environ["BRAINOS_URL"]).hostname
                    in ("localhost", "127.0.0.1")
                    and os.getenv("BRAINOS_LOCAL_STORAGE") == "1"
                ):
                    saved = api(
                        {
                            "action": "local_result",
                            **lease.args,
                            "data": base64.b64encode(output.read_bytes()).decode(),
                        }
                    )
                    file_id = saved["file_id"]
                else:
                    ticket = api({"action": "upload", **lease.args, "bytes": size})
                    request = urllib.request.Request(
                        ticket["url"],
                        data=output.read_bytes(),
                        method="PUT",
                        headers={"Content-Type": "video/mp4"},
                    )
                    with urllib.request.urlopen(request, timeout=180) as response:
                        response.read()
                    file_id = ticket["file_id"]
                result = {
                    "file_id": file_id,
                    "sha256": sha(output),
                    "duration": duration,
                    "bytes": size,
                    "options": job["input"]["options"],
                    "subtitles": captions,
                    "probe": validate_final_video(output),
                }
            if sha(file) != original_hash:
                raise RuntimeError("Original media changed while processing")
            lease.check()
            api({"action": "complete", **lease.args, "result": result})
            (work / "result.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2)
            )
            LOG.info("job succeeded kind=%s id=%s", job["kind"], job["id"])
    except Exception as e:
        # Never print signed URLs or token-bearing request objects.
        message = safe_error(e)
        try:
            api(
                {
                    "action": "fail",
                    "job_id": job["id"],
                    "lease_token": job["lease_token"],
                    "error": message[:1500],
                }
            )
        except Exception:
            pass
        LOG.error("job failed kind=%s id=%s: %s", job["kind"], job["id"], message)
        raise
    return True


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", default=".env.worker.local")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("once")
    sub.add_parser("watch")
    sub.add_parser("doctor")
    reg = sub.add_parser("register")
    reg.add_argument("--package", required=True)
    reg.add_argument("--file", required=True)
    reg.add_argument("--owned", action="store_true", required=True)
    args = parser.parse_args()
    read_env(args.env)
    if args.command == "doctor":
        print(
            subprocess.check_output([ffmpeg(), "-version"], text=True).splitlines()[0]
        )
        import faster_whisper

        print("faster-whisper available; CPU local transcription")
        return
    if len(os.getenv("PRODUCTION_WORKER_TOKEN", "")) < 32:
        raise RuntimeError(
            "Configure the scoped PRODUCTION_WORKER_TOKEN in the private worker env file"
        )
    if args.command == "register":
        f = local_file(args.file)
        p = api({"action": "package", "package_id": args.package})
        duration, video, audio = probe(f)
        media = {
            "id": str(uuid.uuid4()),
            "story_id": p["story_id"],
            "draft_id": p["draft_id"],
            "provider": "local",
            "file_id": str(f),
            "filename": f.name,
            "mime": mimetypes.guess_type(f.name)[0] or "video/mp4",
            "bytes": f.stat().st_size,
            "duration": duration,
            "captured_at": None,
            "uploaded_at": datetime.now(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
            "owned_confirmed": True,
            "sha256": sha(f),
            "status": "received",
        }
        api({"action": "register", "package_id": p["id"], "media": media})
        print(
            "Recording linked to exact approved revision. Queue transcription in BrainOS."
        )
        return
    if args.command == "once":
        setup_logging()
        with WorkerLock():
            process_one()
        return
    watch(process_one)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(
            str(e) if isinstance(e, RuntimeError) else type(e).__name__, file=sys.stderr
        )
        sys.exit(1)
