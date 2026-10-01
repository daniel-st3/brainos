#!/usr/bin/env python3
"""Configure the dedicated BrainOS preview from a private Google web-client JSON."""
import argparse, json, os, shutil, urllib.request, urllib.error
from pathlib import Path

ORIGIN = "https://brainos-daniel-st3s-projects.vercel.app"
PROJECT = "prj_UnhfdSb5poFegUtiMf7Vl6YI5kVb"
TEAM = "team_5avUXFThVjAwm3IsDhzQoSlZ"
ROOT = "14h6iv1SXu7eNSrSC2WpVbXrfgZqJ6xYu"


def dotenv(path):
    return {
        k.strip(): v.strip().strip("\"'")
        for l in path.read_text().splitlines()
        if "=" in l and not l.lstrip().startswith("#")
        for k, v in [l.split("=", 1)]
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, required=True)
    args = parser.parse_args()
    content = json.loads(args.client.read_text())
    client = content.get("web", {})
    if not client.get("client_id", "").endswith(
        ".apps.googleusercontent.com"
    ) or not client.get("client_secret"):
        raise RuntimeError(
            "A downloaded Google OAuth web-application client JSON is required"
        )
    callback = ORIGIN + "/api/integrations/google/callback"
    if callback not in client.get("redirect_uris", []):
        raise RuntimeError(
            "Configure the exact documented callback in Google Cloud and download the JSON again"
        )
    private = Path.home() / "Library/Application Support/BrainOS/oauth"
    private.mkdir(parents=True, exist_ok=True)
    private.chmod(0o700)
    target = private / "google-client.json"
    if args.client.resolve() != target.resolve():
        shutil.copyfile(args.client, target)
    target.chmod(0o600)
    infra = dotenv(Path.home() / ".env.infrastructure.local")
    token = os.environ.get("VERCEL_TOKEN") or infra.get("VERCEL_TOKEN")
    if not token:
        raise RuntimeError(
            "VERCEL_TOKEN is missing from the private infrastructure file/environment"
        )
    values = {
        "GOOGLE_CLIENT_ID": client["client_id"],
        "GOOGLE_CLIENT_SECRET": client["client_secret"],
        "GOOGLE_DRIVE_ROOT_ID": ROOT,
        "CONTENT_OS_ORIGIN": ORIGIN,
        "GMAIL_INTAKE_ENABLED": "false",
    }
    for k, v in values.items():
        request = urllib.request.Request(
            f"https://api.vercel.com/v10/projects/{PROJECT}/env?teamId={TEAM}&upsert=true",
            data=json.dumps(
                {"key": k, "value": v, "target": ["preview"], "type": "encrypted"}
            ).encode(),
            headers={
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                response.read()
        except urllib.error.HTTPError as error:
            raise RuntimeError(
                f"Vercel rejected {k}: HTTP {error.code}; no credentials printed"
            ) from None
    envfile = Path(__file__).resolve().parents[1] / ".env.local"
    old = envfile.read_text().splitlines() if envfile.exists() else []
    old = [line for line in old if not any(line.startswith(k + "=") for k in values)]
    envfile.write_text("\n".join(old + [k + "=" + v for k, v in values.items()]) + "\n")
    envfile.chmod(0o600)
    print(
        "Client stored privately; dedicated preview settings updated. Redeploy preview, then use Conectar Drive. No production changes."
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else type(error).__name__)
        raise SystemExit(1)
