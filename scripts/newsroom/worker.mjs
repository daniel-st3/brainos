import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { produce } from "./pipeline.mjs";
import { closeFeedConnections } from "../../src/ingestion/fetch.ts";
const origin = new URL(
  process.env.BRAINOS_ORIGIN || process.env.BRAINOS_URL || "",
);
if (
  origin.protocol !== "https:" ||
  origin.pathname !== "/" ||
  origin.username ||
  origin.password
)
  throw Error("HTTPS_ORIGIN_REQUIRED");
const credential =
  process.env.PRODUCTION_WORKER_TOKEN || process.env.BRAINOS_WORKER_TOKEN;
if (!credential || credential.length < 32)
  throw Error("SCOPED_WORKER_CREDENTIAL_REQUIRED");
const root = path.resolve(
  process.env.NEWSROOM_WORK_DIR || ".data/newsroom-worker",
);
async function api(data) {
  const r = await fetch(new URL("/api/newsroom/worker", origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-brainos-worker-token": credential,
      ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? {
            "x-vercel-protection-bypass":
              process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          }
        : {}),
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw Error(`WORKER_HTTP_${r.status}`);
  return r.json();
}
let job, heartbeat, power;
try {
  ({ job } = await api({ action: "claim" }));
  if (!job) {
    console.log(JSON.stringify({ state: "idle" }));
  } else {
    if (process.platform === "darwin") {
      power = spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], {
        stdio: "ignore",
      });
      power.on("error", () => {});
    }
    const lease = { job_id: job.id, lease_token: job.lease_token },
      directory = path.join(root, job.id);
    await fs.mkdir(directory, { recursive: true });
    let leaseLost = false;
    heartbeat = setInterval(
      () =>
        api({ action: "heartbeat", ...lease }).catch(() => {
          leaseLost = true;
        }),
      60000,
    );
    const result = await produce(job.input.snapshot, directory);
    if (leaseLost) throw Error("LEASE_LOST");
    for (const m of result.media) {
      const ticket = await api({ action: "upload", ...lease, ...m });
      const u = new URL(ticket.url);
      if (u.protocol !== "https:" || !u.hostname.endsWith(".supabase.co"))
        throw Error("INVALID_UPLOAD_DESTINATION");
      const bytes = await fs.readFile(path.join(directory, m.name));
      const r = await fetch(ticket.url, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: bytes,
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok && r.status !== 409) throw Error("UPLOAD_FAILED");
      m.file_id = ticket.file_id;
    }
    const finished = await api({ action: "complete", ...lease, result });
    await fs.writeFile(
      path.join(directory, "receipt.json"),
      JSON.stringify(finished, null, 2),
    );
    console.log(JSON.stringify(finished));
  }
} catch (e) {
  const known = [
    "PRIMARY_SOURCES_UNAVAILABLE",
    "NO_AUTHENTIC_HIGH_RESOLUTION_MEDIA",
    "CREATIVE_QA_REJECTED",
    "EDITORIAL_QA_FAILED",
  ];
  const error = known.includes(e.message) ? e.message : "EXECUTION_FAILED";
  if (job)
    await api({
      action: "fail",
      job_id: job.id,
      lease_token: job.lease_token,
      error,
    }).catch(() => {});
  console.log(JSON.stringify({ state: "blocked", error }));
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
  power?.kill();
  await closeFeedConnections();
}
