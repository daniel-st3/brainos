import { timingSafeEqual } from "node:crypto";
import { DatabaseIngestionStore, type Rpc } from "../ingestion/store";
import { runIngestion } from "../ingestion/pipeline";
import { enqueueEditorialWork, runOperations } from "./worker";
import { processJobs } from "../control/service";
import type { Story } from "../domain/types";
export type Lane = "discovery" | "operations";
export interface AutomationRun {
  lane: Lane;
  event: string;
  window_at: string;
  status: string;
  finished_at: string | null;
  started_at: string;
}
export function expectedWindow(lane: Lane, now = Date.now()) {
  const d = new Date(now);
  if (lane === "discovery") {
    d.setUTCHours(11, 30, 0, 0);
    if (+d > now) d.setUTCDate(d.getUTCDate() - 1);
  } else {
    d.setUTCMinutes(17, 0, 0);
    if (+d > now) d.setUTCHours(d.getUTCHours() - 1);
  }
  return d.toISOString();
}
export function schedulerHealth(runs: AutomationRun[], now = Date.now()) {
  return Object.fromEntries(
    (["discovery", "operations"] as Lane[]).map((lane) => {
      const expected = expectedWindow(lane, now),
        actual = runs
          .filter((r) => r.lane === lane && r.event === "schedule")
          .sort((a, b) => b.window_at.localeCompare(a.window_at))[0];
      const grace = lane === "discovery" ? 45 * 60000 : 20 * 60000;
      const covers = actual && actual.window_at >= expected;
      return [
        lane,
        {
          expected_at: expected,
          last_actual: actual ?? null,
          state: covers
            ? actual.status === "success"
              ? "healthy"
              : actual.status === "failed"
                ? "failed"
                : now - Date.parse(actual.started_at) > 480000
                  ? "stale"
                  : "running"
            : now - Date.parse(expected) > grace
              ? "missed"
              : "awaiting",
          authority: "supabase-cron",
        },
      ];
    }),
  );
}
export function schedulerAuthorized(request: Request) {
  const secret = process.env.BRAINOS_SCHEDULER_SECRET,
    token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return (
    !!secret &&
    secret.length >= 32 &&
    Buffer.byteLength(token) === Buffer.byteLength(secret) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(secret))
  );
}
export async function executeAutomation(
  rpc: Rpc,
  lane: Lane,
  event: "schedule" | "manual",
  window = event === "schedule"
    ? expectedWindow(lane)
    : new Date().toISOString(),
) {
  const id = await rpc("claim_automation", {
    p_lane: lane,
    p_window: window,
    p_event: event,
  });
  if (!id) return { duplicate: true };
  try {
    const results: unknown[] = [];
    let ingestionFailed = false;
    if (lane === "discovery") {
      const runs = await runIngestion(new DatabaseIngestionStore(rpc));
      results.push(runs);
      ingestionFailed = runs.some((r) =>
        ["failed", "partial"].includes(r.status),
      );
    }
    const stories = (await rpc("read_newsroom")) as Story[];
    await enqueueEditorialWork(
      rpc,
      lane === "discovery"
        ? stories
        : stories.filter(
            (s) =>
              s.status === "angle_ready" &&
              s.research_confirmed &&
              !s.drafts.length,
          ),
    );
    const operations = await runOperations(rpc, 30);
    results.push(operations);
    for (const kind of ["graphic", "distribution", "analytics"] as const)
      results.push(await processJobs(rpc, kind, false));
    const { processOutbox } = await import("../providers/outbox");
    results.push(await processOutbox(rpc, false));
    await rpc("cleanup_activation");
    const { driveConnectionStatus } =
      await import("../integrations/drive-status");
    const drive = await driveConnectionStatus(rpc);
    results.push({ smoke: { database: "reachable", drive: drive.state } });
    const { notifyOperations } = await import("./center");
    await notifyOperations(rpc, false);
    if (ingestionFailed)
      throw Error(
        "One or more discovery sources failed; operations still ran. Inspect source health.",
      );
    if (operations.some((r) => r.status === "failed"))
      throw Error("Editorial operations failed; inspect failure inbox");
    await rpc("finish_automation", {
      p_id: id,
      p_success: true,
      p_result: { results },
      p_error: null,
    });
    return { id, status: "success" };
  } catch (e) {
    await rpc("finish_automation", {
      p_id: id,
      p_success: false,
      p_result: {},
      p_error: e instanceof Error ? e.message : "Automation failed",
    });
    throw e;
  }
}
