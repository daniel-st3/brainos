import { randomUUID } from "node:crypto";
import type { Rpc } from "../ingestion/store";
import type { DiscoveryState } from "../ingestion/types";
import { controlSnapshot } from "../control/service";
import { schedulerHealth, type AutomationRun } from "./automation";
import { workerAvailable, type Entity } from "../control/model";
export async function operationsCenter(rpc: Rpc, demo: boolean) {
  const [{ state, stories, production }, runs, discovery, outbox] =
    await Promise.all([
      controlSnapshot(rpc, demo),
      rpc("read_automation") as Promise<AutomationRun[]>,
      rpc("read_discovery_state") as Promise<DiscoveryState>,
      rpc("read_provider_outbox", { p_demo: demo }) as Promise<
        {
          id: string;
          status: string;
          provider: string;
          error: string;
          attempts: number;
          updated_at: string;
        }[]
      >,
    ]);
  const scheduler = schedulerHealth(runs),
    failures = [
      ...state.entities
        .filter(
          (e) =>
            e.kind === "notification" &&
            e.data.type === "oauth_failure" &&
            !e.data.read_at,
        )
        .map((e) => ({
          id: e.id,
          subsystem: "OAuth",
          error: String(e.data.title),
          status: "unread",
          attempts: 1,
          href: "/activation",
          recovery: "none",
        })),
      ...state.entities
        .filter(
          (e) =>
            e.kind === "account" &&
            ["degraded", "auth_required", "revoked"].includes(
              String(e.data.status),
            ),
        )
        .map((e) => ({
          id: e.id,
          subsystem: "OAuth",
          error: String(e.data.reason ?? "Provider authorization required"),
          status: String(e.data.status),
          attempts: 0,
          href: "/activation",
          recovery: "none",
        })),
      ...state.jobs
        .filter((j) => ["blocked", "failed", "dead_letter"].includes(j.status))
        .map((j) => ({
          id: j.id,
          subsystem: j.kind,
          error: j.error ?? j.status,
          status: j.status,
          attempts: j.attempts ?? 0,
          href: "/workbench?tab=operations",
          recovery: "control",
        })),
      ...outbox
        .filter((j) =>
          ["blocked", "dead_letter", "uncertain"].includes(j.status),
        )
        .map((j) => ({
          id: j.id,
          subsystem: "distribution",
          error: j.error,
          status: j.status,
          attempts: j.attempts,
          href: "/activation",
          recovery: "outbox",
        })),
      ...production.jobs
        .filter((j) => ["failed", "blocked"].includes(j.status))
        .map((j) => ({
          id: j.id,
          subsystem: "media",
          error: j.error ?? j.status,
          status: j.status,
          attempts: 0,
          href: "/production/studio",
          recovery: "media",
        })),
      ...discovery.runs
        .filter((r) => r.status === "failed")
        .slice(0, 8)
        .map((r) => ({
          id: r.id,
          subsystem: "ingestion",
          error: "Source failed; inspect source health",
          status: r.status,
          attempts: 1,
          href: "/sources",
          recovery: "none",
        })),
      ...Object.entries(scheduler)
        .filter(([, s]) => ["missed", "failed", "stale"].includes(s.state))
        .map(([lane, s]) => ({
          id: lane + ":" + s.expected_at,
          subsystem: "scheduler",
          error: `${lane}: ${s.state}`,
          status: s.state,
          attempts: 0,
          href: "/operations-center",
          recovery: "none",
        })),
    ];
  return {
    scheduler,
    worker: { available: workerAvailable(state), presence: state.workers },
    failures,
    notifications: state.entities.filter((e) => e.kind === "notification"),
    analytics_ready: state.entities
      .filter(
        (e) =>
          e.kind === "publication" &&
          (e.data.metrics as unknown[] | undefined)?.length,
      )
      .map((e) => ({
        key: `analytics:${e.id}:${(e.data.metrics as unknown[]).length}`,
        title: "Analytics ready for review",
        href: "/workbench?tab=analytics",
      })),
    brief_ready: discovery.runs
      .filter((r) => r.status === "success")
      .slice(0, 1)
      .map((r) => ({
        key: `brief:${r.id}`,
        title: "Morning Brief updated",
        href: "/brief",
      })),
    pending_scripts: stories.flatMap((s) =>
      s.drafts
        .filter((d) => d.status === "draft" && d.id === s.active_draft_id)
        .map((d) => ({
          key: `script:${d.id}`,
          title: "Script ready for human review",
          href: `/stories/${s.id}?tab=drafts`,
        })),
    ),
    final_renders: production.packages
      .filter((p) => p.valid && p.data.state === "rendered")
      .map((p) => ({
        key: `render:${p.id}:${p.version}`,
        title: "Final render ready",
        href: `/production/studio?package=${p.id}`,
      })),
    state,
  };
}
export async function notifyOperations(rpc: Rpc, demo: boolean) {
  const center = await operationsCenter(rpc, demo),
    existing = new Set(center.notifications.map((e) => e.data.key)),
    signals = [
      ...center.brief_ready,
      ...center.analytics_ready,
      ...center.pending_scripts,
      ...center.final_renders,
      ...center.failures.map((f) => ({
        key: `failure:${f.subsystem}:${f.id}:${f.error}`,
        title: f.error,
        href: f.href,
      })),
    ],
    changes: Entity[] = signals
      .filter((s) => !existing.has(s.key))
      .map((s) => ({
        id: randomUUID(),
        kind: "notification",
        version: 1,
        story_id: null,
        draft_id: null,
        parent_id: null,
        is_demo: demo,
        data: {
          ...s,
          status: "unread",
          created_at: new Date().toISOString(),
          read_at: null,
        },
      }));
  if (changes.length)
    await rpc("commit_control", {
      p_epoch: center.state.epoch,
      p_entities: changes,
      p_jobs: [],
      p_public: [],
      p_actor: "operations-notifications",
    });
  return { created: changes.length };
}
