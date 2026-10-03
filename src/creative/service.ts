import { creativeHash as hash } from "./fingerprint";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Rpc } from "../ingestion/store";
import type { Story } from "../domain/types";
import { type ControlState, type Entity, type Job } from "../control/model";
import { creativePackageSchema, creativeOperations } from "./schema";
import {
  currentCreative,
  importedCandidate,
  type CreativeRecord,
  type CreativeMedia,
} from "./model";
import { creativeJob } from "./jobs";

const id = z.uuid(),
  text = z.string().trim().min(1).max(12000);
export const creativeCommand = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("creative_asset_review"),
    id,
    candidate_id: id,
    decision: z.enum(["accepted", "rejected"]),
    selected: z.boolean(),
    confirmed: z.literal(true),
  }),
  z.strictObject({
    action: z.literal("creative_save"),
    id: id.optional(),
    package: creativePackageSchema,
  }),
  z.strictObject({
    action: z.literal("creative_approve"),
    id,
    confirmed: z.literal(true),
  }),
  z.strictObject({
    action: z.literal("creative_job_queue"),
    id,
    operation: z.enum(creativeOperations),
  }),
  z.strictObject({
    action: z.literal("creative_handoff_request"),
    id,
    handoff_id: id,
    provider: z.enum(["chatgpt_manual", "canva_manual"]),
    requirement_id: id.optional(),
    request: text,
    prompt_reference: z.string().max(12000).nullable(),
  }),
  z.strictObject({
    action: z.literal("creative_canva_editing"),
    id,
    handoff_id: id,
  }),
  z.strictObject({
    action: z.literal("creative_import"),
    id,
    handoff_id: id,
    media_id: id,
    requirement_id: id,
    generated_at: z.iso.datetime().nullable(),
    rights_usage_notes: text,
    confirmed: z.literal(true),
  }),
]);
export async function creativeAction(
  rpc: Rpc,
  raw: unknown,
  actor: string,
  demo: boolean,
  expectedEpoch?: number,
) {
  if (!actor || actor === "local-worker") throw Error("Human editor required");
  const c = creativeCommand.parse(raw);
  const [all, allStories] = await Promise.all([
    rpc("read_control") as Promise<ControlState>,
    rpc("read_newsroom") as Promise<Story[]>,
  ]);
  const state = {
    ...all,
    entities: all.entities.filter((e) => e.is_demo === demo),
    jobs: all.jobs.filter((j) => j.is_demo === demo),
  };
  const stories = allStories.filter((s) => s.is_demo === demo);
  if (expectedEpoch !== undefined && expectedEpoch !== state.epoch)
    throw Error("Conflict: refresh the creative record");
  const old =
    "id" in c && c.id
      ? (state.entities.find((e) => e.id === c.id && e.kind === "creative") as
          Entity<CreativeRecord> | undefined)
      : undefined;
  if (c.action !== "creative_save" && !old)
    throw Error("Creative record missing");
  if (c.action === "creative_save" && c.id && !old)
    throw Error("Creative record missing");
  const now = new Date().toISOString();
  let data: CreativeRecord;
  if (c.action === "creative_save") {
    if (
      old &&
      (old.data.package.brief.id !== c.package.brief.id ||
        c.package.brief.revision !== old.data.package.brief.revision + 1)
    )
      throw Error("Save a new exact creative brief revision");
    if (!old && c.package.brief.revision !== 1)
      throw Error("Initial brief revision must be one");
    if (
      c.package.handoffs.length ||
      c.package.assets.some((a) => a.import_provenance)
    )
      throw Error(
        "Request/import external handoffs through the verified manual flow; previous revisions remain in history",
      );
    currentCreative(c.package, state, stories);
    data = { status: "draft", package: c.package, approval: null };
  } else {
    data = structuredClone(old!.data);
    currentCreative(data.package, state, stories);
    if (c.action === "creative_job_queue") {
      const job = creativeJob(old!, c.operation, now);
      const existing = state.jobs.find(
        (j) => j.idempotency_key === job.idempotency_key,
      );
      if (existing) return { id: existing.id, epoch: state.epoch };
      const epoch = await commit(rpc, state.epoch, [], [job], actor);
      return { id: job.id, epoch };
    }
    if (c.action === "creative_approve") {
      if (
        data.status === "approved" &&
        data.approval?.fingerprint === hash(data.package)
      )
        return { id: old!.id, epoch: state.epoch };
      data.status = "approved";
      data.approval = { actor, at: now, fingerprint: hash(data.package) };
    } else {
      data.status = "draft";
      data.approval = null;
      if (c.action === "creative_handoff_request") {
        const existing = data.package.handoffs.find(
          (h) => h.id === c.handoff_id,
        );
        if (existing) {
          if (
            existing.request !== c.request ||
            existing.provider !== c.provider ||
            existing.requirement_id !== c.requirement_id ||
            existing.prompt_reference !== c.prompt_reference
          )
            throw Error("Handoff idempotency key reused with different input");
          return { id: old!.id, epoch: state.epoch };
        }
        data.package.handoffs.push({
          id: c.handoff_id,
          provider: c.provider,
          brief_id: data.package.brief.id,
          brief_revision: data.package.brief.revision,
          requirement_id: c.requirement_id,
          request: c.request,
          prompt_reference: c.prompt_reference,
          state:
            c.provider === "chatgpt_manual"
              ? "WAITING_FOR_EXTERNAL_VISUAL"
              : "CANVA_HANDOFF_READY",
          requested_at: now,
          candidate_id: null,
        });
      } else if (c.action === "creative_asset_review") {
        const a = data.package.assets.find((a) => a.id === c.candidate_id);
        if (!a) throw Error("Creative asset candidate missing");
        a.human_review = c.decision;
        a.selected = c.selected && c.decision === "accepted";
        if (a.media_id) {
          const receipt = (await rpc("read_creative_media", {
            p_id: a.media_id,
          })) as CreativeMedia | null;
          if (
            !receipt ||
            receipt.story_id !== data.package.binding.story_id ||
            receipt.draft_id !== data.package.binding.draft_id ||
            receipt.sha256 !== a.sha256
          )
            throw Error("Current verified asset receipt required");
          a.authoritative_asset_id = receipt.asset_id;
          a.rights_status =
            stories
              .find((s) => s.id === receipt.story_id)
              ?.assets.find((asset) => asset.id === receipt.asset_id)
              ?.rights_status ?? "unknown";
        }
        a.publishable = false;
      } else if (c.action === "creative_canva_editing") {
        const h = data.package.handoffs.find(
          (h) => h.id === c.handoff_id && h.provider === "canva_manual",
        );
        if (!h || !["CANVA_HANDOFF_READY", "CANVA_EDITING"].includes(h.state))
          throw Error("Canva handoff not ready");
        if (h.state === "CANVA_EDITING")
          return { id: old!.id, epoch: state.epoch };
        h.state = "CANVA_EDITING";
      } else if (c.action === "creative_import") {
        const h = data.package.handoffs.find((h) => h.id === c.handoff_id);
        if (!h) throw Error("Manual handoff missing");
        if (h.candidate_id) {
          const previous = data.package.assets.find(
            (a) => a.id === h.candidate_id,
          );
          if (
            previous?.media_id !== c.media_id ||
            previous.requirement_id !== c.requirement_id ||
            previous.import_provenance?.generated_at !== c.generated_at ||
            previous.import_provenance.rights_usage_notes !==
              c.rights_usage_notes
          )
            throw Error(
              "Handoff already imported; request a new handoff for a different selection",
            );
          return { id: old!.id, epoch: state.epoch };
        }
        const receipt = (await rpc("read_creative_media", {
          p_id: c.media_id,
        })) as CreativeMedia | null;
        if (
          !receipt ||
          !["image/png", "image/jpeg", "video/mp4"].includes(receipt.mime_type)
        )
          throw Error("Verified private PNG/JPEG/video upload required");
        const candidate = importedCandidate(
          data.package,
          h.id,
          receipt,
          c,
          now,
        );
        data.package.assets.push(candidate);
        h.candidate_id = candidate.id;
        h.state =
          h.provider === "chatgpt_manual"
            ? "EXTERNAL_VISUAL_IMPORTED"
            : "CANVA_EXPORT_IMPORTED";
      }
    }
  }
  data.package = creativePackageSchema.parse(data.package);
  const entity: Entity<CreativeRecord> = {
    id: old?.id ?? randomUUID(),
    kind: "creative",
    version: (old?.version ?? 0) + 1,
    story_id: data.package.binding.story_id,
    draft_id: data.package.binding.draft_id,
    parent_id: data.package.binding.content_id,
    is_demo: demo,
    data,
  };
  const epoch = await commit(rpc, state.epoch, [entity], [], actor);
  return { id: entity.id, epoch };
}
function commit(
  rpc: Rpc,
  epoch: number,
  entities: Entity<CreativeRecord>[],
  jobs: Job[],
  actor: string,
) {
  return rpc("commit_control", {
    p_epoch: epoch,
    p_entities: entities,
    p_jobs: jobs,
    p_public: [],
    p_actor: actor,
  }) as Promise<number>;
}
