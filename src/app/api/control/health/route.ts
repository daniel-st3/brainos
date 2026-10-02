import type { DiscoveryState } from "@/ingestion/types";
import { NextResponse } from "next/server";
import { editor } from "@/server/auth";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
import { controlSnapshot, accounts } from "@/control/service";
import { workerAvailable } from "@/control/model";
import { driveConnectionStatus } from "@/integrations/drive-status";
import { schedulerHealth, type AutomationRun } from "@/operations/automation";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await editor();
    const rpc = await applicationRpc(),
      { state, stories, production } = await controlSnapshot(
        rpc,
        dataMode() === "demo",
      );
    const latest = stories
      .map((s) => Date.parse(s.discovered_at))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    const discovery = (await rpc("read_discovery_state")) as DiscoveryState,
      lastRun = discovery.runs
        .filter((r) => r.completed_at)
        .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))[0];
    return NextResponse.json(
      {
        database: "reachable",
        drive: await driveConnectionStatus(rpc),
        worker: {
          available: workerAvailable(state),
          protocol: 1,
          presence: state.workers,
        },
        ingestion: {
          latest_signal_at: latest ? new Date(latest).toISOString() : null,
          fresh:
            !!lastRun &&
            Date.now() - Date.parse(lastRun.completed_at!) < 36 * 3600000,
          last_completed_run: lastRun
            ? {
                at: lastRun.completed_at,
                status: lastRun.status,
                source_id: lastRun.source_id,
              }
            : null,
          recent_failures: discovery.runs
            .filter((r) => r.status === "failed")
            .slice(0, 8)
            .map((r) => ({
              source_id: r.source_id,
              at: r.completed_at,
              errors: r.errors,
            })),
        },
        scheduler: schedulerHealth(
          (await rpc("read_automation")) as AutomationRun[],
        ),
        providers: accounts(state),
        jobs: {
          blocked: state.jobs.filter((j) => j.status === "blocked").length,
          failed: state.jobs.filter((j) =>
            ["failed", "dead_letter"].includes(j.status),
          ).length,
          media: production.jobs.map((j) => ({
            id: j.id,
            status: j.status,
            kind: j.kind,
          })),
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Health check failed" },
      { status: 503 },
    );
  }
}
