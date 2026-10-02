import { z } from "zod";
import type { Rpc } from "../ingestion/store";
import type { Story } from "../domain/types";
import type { ProductionPackage, StudioState, MediaJob } from "./types";
import {
  assertCurrent,
  createPackage,
  roughEdit,
  renderIssues,
  renderOptionsSchema,
  renderSpec,
  acceptTranscript,
} from "./model";
export async function studio(rpc: Rpc): Promise<StudioState> {
  const [state, stories] = await Promise.all([
    rpc("read_production") as Promise<StudioState>,
    rpc("read_newsroom") as Promise<Story[]>,
  ]);
  return validateStudio(state, stories);
}
/** Validate against the same story snapshot already loaded by the control plane. */
export function validateStudio(
  state: StudioState,
  stories: Story[],
): StudioState {
  for (const p of state.packages) {
    try {
      const s = stories.find((s) => s.id === p.story_id);
      if (!s) throw Error("Story missing");
      assertCurrent(p, s);
    } catch (e) {
      p.valid = false;
      p.invalid_reason = e instanceof Error ? e.message : "Approval mismatch";
    }
  }
  return state;
}
export async function currentPackage(rpc: Rpc, id: string) {
  const p = (await studio(rpc)).packages.find((p) => p.id === id);
  if (!p) throw Error("Production package missing");
  if (!p.valid) throw Error(p.invalid_reason ?? "Production invalidated");
  return p;
}
export async function savePackage(
  rpc: Rpc,
  p: ProductionPackage,
  actor: string,
  job?: MediaJob,
) {
  const story = ((await rpc("read_newsroom")) as Story[]).find(
    (s) => s.id === p.story_id,
  );
  if (!story) throw Error("Story missing");
  assertCurrent(p, story);
  return (await rpc("save_production", {
    p_package: p,
    p_expected: p.version,
    p_actor: actor,
    p_job: job?.id ?? null,
    p_token: job?.lease_token ?? null,
  })) as ProductionPackage;
}
const id = z.uuid(),
  version = z.number().int().positive();
export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), draft_id: id }),
  z.object({ action: z.literal("plan"), id, version }),
  z.object({
    action: z.literal("review_transcript"),
    id,
    version,
    confirmed: z.literal(true),
  }),
  z.object({
    action: z.literal("review_plan"),
    id,
    version,
    confirmed: z.literal(true),
  }),
  z.object({
    action: z.literal("asset"),
    id,
    version,
    asset_id: id,
    required: z.boolean(),
    rights: z.enum(["unknown", "cleared", "blocked"]),
    basis: z.string().max(2000),
    attribution: z.string().max(2000),
    reference: z.string().max(1000),
    confirmed: z.boolean(),
  }),
  z.object({ action: z.literal("ready"), id, version }),
  z.object({ action: z.literal("review"), id, version }),
  z.object({
    action: z.literal("approve"),
    id,
    version,
    confirmed: z.literal(true),
  }),
  z.object({ action: z.literal("transcribe"), id, version }),
  z.object({
    action: z.literal("render"),
    id,
    version,
    options: renderOptionsSchema,
  }),
  z.object({ action: z.literal("retry"), job_id: id }),
  z.object({
    action: z.literal("batch"),
    name: z.string().min(1).max(120),
    package_ids: z.array(id).min(3).max(10),
  }),
]);
export async function productionAction(rpc: Rpc, raw: unknown, actor: string) {
  const a = actionSchema.parse(raw);
  if (a.action === "create") {
    const state = await studio(rpc),
      existing = state.packages.find((p) => p.draft_id === a.draft_id);
    if (existing) {
      if (!existing.valid)
        throw Error(
          "This revision has an invalidated recording package. Approve a new script revision.",
        );
      return existing;
    }
    const s = ((await rpc("read_newsroom")) as Story[]).find((s) =>
      s.drafts.some((d) => d.id === a.draft_id),
    );
    if (!s) throw Error("Draft missing");
    return savePackage(rpc, createPackage(s, a.draft_id, actor), actor);
  }
  if (a.action === "batch") {
    if (new Set(a.package_ids).size !== a.package_ids.length)
      throw Error("Batch pieces must be distinct");
    for (const id of a.package_ids) await currentPackage(rpc, id);
    return rpc("save_production_batch", {
      p_id: crypto.randomUUID(),
      p_name: a.name,
      p_packages: a.package_ids,
    });
  }
  if (a.action === "retry") return rpc("retry_production", { p_job: a.job_id });
  const p = await currentPackage(rpc, a.id);
  if (p.version !== a.version)
    throw Error("Conflict: production changed; refresh");
  const d = p.data;
  if (a.action === "transcribe" || a.action === "render") {
    if (!d.selected_media_id) throw Error("Recording required");
    if (a.action === "render") renderSpec(p, a.options);
    return rpc("queue_production", {
      p_package: p.id,
      p_version: p.version,
      p_kind: a.action,
      p_input: {
        media_id: d.selected_media_id,
        ...(a.action === "render" ? { options: a.options } : {}),
      },
    });
  }
  if (a.action === "review_transcript") {
    if (
      !d.transcript ||
      ![
        "transcribed",
        "edit_plan_ready",
        "assets_ready",
        "render_ready",
      ].includes(d.state)
    )
      throw Error("Review a current transcript before rendering");
    d.transcript.reviewed = true;
  } else if (a.action === "plan") {
    if (!["transcribed", "edit_plan_ready"].includes(d.state))
      throw Error("Prepare the plan after transcription");
    d.edit_plan = roughEdit(p);
    d.state = "edit_plan_ready";
  } else if (a.action === "review_plan") {
    if (
      !d.edit_plan ||
      !["edit_plan_ready", "assets_ready", "render_ready"].includes(d.state)
    )
      throw Error("Edit plan missing");
    d.edit_plan.reviewed = true;
  } else if (a.action === "asset") {
    const asset = d.assets.find((x) => x.id === a.asset_id);
    if (!asset) throw Error("Asset missing");
    if (
      a.rights === "cleared" &&
      (!a.confirmed || !a.basis.trim() || !a.reference.trim())
    )
      throw Error(
        "Explicit rights confirmation, usage basis and file/reference required",
      );
    Object.assign(asset, {
      required: a.required,
      rights: a.rights,
      publishable: a.rights === "cleared" && a.confirmed,
      basis: a.basis,
      attribution: a.attribution,
      reference: a.reference,
      cleared_by: a.rights === "cleared" ? actor : undefined,
    });
    d.output = null;
    d.approval = null;
    if (d.edit_plan) d.state = "edit_plan_ready";
  } else if (a.action === "ready") {
    if (!["edit_plan_ready", "assets_ready"].includes(d.state))
      throw Error("Edit plan required before render readiness");
    const issues = renderIssues(p);
    if (issues.length) throw Error(issues.join(". "));
    d.state = "render_ready";
  } else if (a.action === "review") {
    if (d.state !== "rendered" || !d.output)
      throw Error("Rendered output required");
    d.state = "review";
  } else if (a.action === "approve") {
    if (d.state !== "review" || !d.output)
      throw Error("Review the rendered output before final approval");
    const issues = renderIssues(p);
    if (issues.length) throw Error(issues.join(". "));
    d.approval = {
      actor,
      at: new Date().toISOString(),
      production_version: p.version + 1,
      output_sha256: d.output.sha256,
    };
    d.state = "approved";
  }
  return savePackage(rpc, p, actor);
}
export async function finishTranscript(
  rpc: Rpc,
  job: MediaJob,
  result: unknown,
) {
  const p = await currentPackage(rpc, job.package_id);
  if (p.version !== job.package_version)
    throw Error("Production changed during processing");
  return savePackage(rpc, acceptTranscript(p, result), "local-worker", job);
}
