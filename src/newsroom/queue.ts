import { randomUUID } from "node:crypto";
import type { Rpc } from "../ingestion/store";
import { readControl } from "../control/service";
import type { CreatorSnapshot } from "../creator/discovery";
export const runner = "newsroom-exec/v1";
/** One explicit staging run at a time. No pilot mutation and no production quota. */
export async function queueNewsroomRun(rpc: Rpc, snapshot: CreatorSnapshot) {
  const s = await readControl(rpc, true),
    key = `${runner}/${snapshot.captured_at.slice(0, 13)}`;
  const prior = s.jobs.find((j) => j.idempotency_key === key);
  if (prior) return prior.id;
  if (
    s.jobs.some(
      (j) =>
        j.input.runner === runner && ["queued", "running"].includes(j.status),
    )
  )
    return null;
  if (!snapshot.briefs.some((b) => b.eligible_for_research)) return null;
  const id = randomUUID(),
    job = randomUUID(),
    now = new Date().toISOString();
  await rpc("commit_control", {
    p_epoch: s.epoch,
    p_entities: [
      {
        id,
        kind: "experiment",
        version: 1,
        story_id: null,
        draft_id: null,
        parent_id: null,
        is_demo: true,
        data: { type: runner, status: "queued", snapshot },
      },
    ],
    p_jobs: [
      {
        id: job,
        kind: "creative",
        entity_id: id,
        entity_version: 1,
        is_demo: true,
        idempotency_key: key,
        status: "queued",
        due_at: now,
        input: {
          runner,
          snapshot,
          story_id: randomUUID(),
          content_id: randomUUID(),
          package_id: randomUUID(),
        },
        error: null,
        retryable: true,
      },
    ],
    p_public: [],
    p_actor: "creator-staging-production",
  });
  return job;
}
