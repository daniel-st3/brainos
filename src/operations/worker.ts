import type { Rpc } from "../ingestion/store";
import type { Story } from "../domain/types";
import { applyCommand } from "../domain/workflow";
import { evidenceFingerprint, researchPacket } from "./research";
import { approvedProductionPacket, postRecordingPlan } from "./production";
import {
  analyticsAdapters,
  analyticsProviderFor,
  snapshotDue,
  snapshotWindows,
  type AnalyticsProvider,
} from "../integrations/analytics";
export interface OperationJob {
  id: string;
  kind: string;
  story_id: string;
  payload: Record<string, unknown>;
  lease_token: string;
  attempts: number;
}
class ConfigurationRequired extends Error {}
export async function enqueueEditorialWork(rpc: Rpc, stories: Story[]) {
  let count = 0;
  for (const story of stories.filter((s) => !s.is_demo && !s.archived)) {
    await rpc("enqueue_operation", {
      p_kind: "enrich",
      p_key: `enrich:${story.id}:${evidenceFingerprint(story)}`,
      p_story: story.id,
      p_payload: { fingerprint: evidenceFingerprint(story) },
    });
    count++;
    // Only explicit human research + angle approval makes drafting eligible.
    if (
      story.status === "angle_ready" &&
      story.research_confirmed &&
      !story.discovery?.needs_review &&
      !story.drafts.length
    ) {
      const angle = story.angles.find(
        (a) =>
          a.approval_state === "approved" && a.approved_by && a.approved_at,
      );
      if (angle)
        await rpc("enqueue_operation", {
          p_kind: "draft",
          p_key: `draft:${story.id}:${angle.id}`,
          p_story: story.id,
          p_payload: { angleId: angle.id },
        });
    }
    for (const pub of story.publications.filter(
      (p) => p.status === "published_manual" && p.published_url,
    )) {
      // Existing domain records actual publication as a transition, not scheduled_at.
      const published = story.events.find(
        (e) => e.to_status === "published" && e.draft_id === pub.draft_id,
      )?.created_at;
      if (!published) continue;
      const provider = analyticsProviderFor(pub.platform, pub.published_url!);
      if (!provider) continue;
      for (const hours of snapshotWindows)
        await rpc("enqueue_operation", {
          p_kind: "analytics",
          p_key: `analytics:${pub.id}:${provider}:${hours}`,
          p_story: story.id,
          p_due: snapshotDue(published, hours),
          p_payload: { publicationId: pub.id, provider, hours },
        });
    }
  }
  return count;
}
export async function runOperations(rpc: Rpc, limit = 20) {
  const results: { id: string; status: string }[] = [];
  for (let i = 0; i < Math.min(limit, 100); i++) {
    const job = (await rpc("claim_operation")) as OperationJob | null;
    if (!job) break;
    try {
      const stories = (await rpc("read_newsroom")) as Story[];
      const story = stories.find((s) => s.id === job.story_id);
      if (!story) throw new Error("Story missing");
      let result: unknown;
      if (job.kind === "enrich") {
        if (evidenceFingerprint(story) !== job.payload.fingerprint) {
          result = {
            skipped: "Evidence changed; a fresh job will be enqueued.",
          };
        } else {
          result = researchPacket(story);
          await rpc("record_generation", {
            p_job: job.id,
            p_token: job.lease_token,
            p_provider: "deterministic-evidence/v1",
            p_fingerprint: evidenceFingerprint(story),
            p_sources: story.sources.map((s) => s.id),
            p_output: result,
          });
        }
      } else if (job.kind === "draft") {
        if (
          !story.research_confirmed ||
          story.discovery?.needs_review ||
          !["angle_ready", "drafted"].includes(story.status)
        )
          throw new ConfigurationRequired(
            "Human research confirmation and approved angle required.",
          );
        let current = story;
        for (const platform of [
          "short_video",
          "instagram",
          "x",
          "newsletter",
        ] as const) {
          if (current.drafts.some((d) => d.platform === platform)) continue;
          const updated = await applyCommand(
            current,
            {
              type: "generate_draft",
              angleId: String(job.payload.angleId),
              platform,
            },
            "system:editorial-worker",
          );
          await rpc("commit_operation_story", {
            p_job: job.id,
            p_token: job.lease_token,
            p_story: updated,
            p_version: current.version,
          });
          current = updated;
        }
        result = {
          draftIds: current.drafts.map((d) => d.id),
          approval: "required",
        };
        await rpc("record_generation", {
          p_job: job.id,
          p_token: job.lease_token,
          p_provider: "deterministic-editorial/v1",
          p_fingerprint: evidenceFingerprint(story),
          p_sources: story.sources.map((s) => s.id),
          p_output: result,
        });
      } else if (job.kind === "production") {
        result = approvedProductionPacket(story, String(job.payload.draftId));
        await rpc("record_generation", {
          p_job: job.id,
          p_token: job.lease_token,
          p_provider: "approved-revision-export/v1",
          p_fingerprint: evidenceFingerprint(story),
          p_sources: story.sources.map((s) => s.id),
          p_output: result,
        });
      } else if (job.kind === "analytics") {
        const provider = String(job.payload.provider) as AnalyticsProvider,
          adapter = analyticsAdapters[provider];
        if (!adapter)
          throw new ConfigurationRequired(
            `${provider} official analytics runtime authorization is not configured.`,
          );
        const pub = story.publications.find(
          (p) =>
            p.id === job.payload.publicationId &&
            p.status === "published_manual",
        );
        if (!pub) throw new Error("Confirmed publication missing");
        const postId = String(job.payload.providerPostId ?? "");
        if (!postId)
          throw new ConfigurationRequired(
            "Provider post ID required; URL is not a verified provider ID.",
          );
        const metrics = await adapter.collect(postId);
        await rpc("record_analytics", {
          p_publication: pub.id,
          p_provider: provider,
          p_window: job.payload.hours,
          p_post_id: postId,
          p_metrics: metrics.rawMetrics,
        });
        result = metrics;
      } else throw new ConfigurationRequired(postRecordingPlan.reason);
      await rpc("finish_operation", {
        p_id: job.id,
        p_token: job.lease_token,
        p_status: "succeeded",
        p_result: result,
      });
      results.push({ id: job.id, status: "succeeded" });
    } catch (error) {
      const blocked = error instanceof ConfigurationRequired;
      const message =
        error instanceof Error ? error.message : "Operation failed";
      console.error(
        JSON.stringify({
          job: job.id,
          kind: job.kind,
          status: blocked ? "blocked" : "failed",
          error: message,
        }),
      );
      await rpc("finish_operation", {
        p_id: job.id,
        p_token: job.lease_token,
        p_status: blocked ? "blocked" : "failed",
        p_error: message,
      });
      results.push({ id: job.id, status: blocked ? "blocked" : "failed" });
    }
  }
  return results;
}
