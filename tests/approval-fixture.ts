import {
  controlAction,
  controlSnapshot,
  readControl,
} from "../src/control/service";
import type { Rpc } from "../src/ingestion/store";
/** Explicit demo namespace, never connects any provider or creates a live approval. */
export async function approvalFixture(rpc: Rpc, media = false) {
  const run = (command: unknown) =>
    controlAction(rpc, command, "SIMULATION reviewer", true);
  let state = await readControl(rpc, true);
  if (
    !state.entities.some(
      (e) => e.kind === "brand" && e.data.status === "active",
    )
  ) {
    const b = await run({
      action: "brand_save",
      name: "SIMULATION",
      positioning: "Workflow verification",
      audience: "Test reviewer",
      pillars: ["Test"],
      tone: ["Specific"],
      cta: "Review",
    });
    await run({ action: "brand_approve", id: b.id, confirmed: true });
  }
  const story = (await controlSnapshot(rpc, true)).stories.find(
    (s) => s.status === "approved",
  )!;
  const i = await run({
    action: "idea_create",
    title: "SIMULATION — cloud approval",
    source: "story",
    story_id: story.id,
    provenance: "Fictional test, never live reporting",
  });
  for (const target of ["qualified", "selected"])
    await run({ action: "idea_transition", id: i.id, target });
  const c = await run({
    action: "content_create",
    idea_id: i.id,
    platform: "x",
    format: "post",
    purpose: "Safe cloud approval test",
  });
  await run({
    action: "content_bind",
    id: c.id,
    draft_id: story.active_draft_id,
  });
  await run({
    action: "content_freshness",
    id: c.id,
    evergreen: true,
    fresh_until: null,
    confirmed: true,
  });
  for (const target of ["review", "approved"])
    await run({
      action: "content_transition",
      id: c.id,
      target,
      confirmed: true,
    });
  const graphics: string[] = [];
  if (media) {
    const g = await run({
      action: "graphic_queue",
      content_id: c.id,
      template: "cover",
      aspect: "1:1",
      headline: "SIMULATION",
      text: "Approval test. No social post.",
      source_ids: [story.sources[0].id],
      slides: [],
    });
    await run({ action: "graphics_process" });
    await run({
      action: "graphic_clear",
      id: g.id,
      basis: "Owned fictional test typography only",
      scope: "x",
      confirmed: true,
    });
    await run({ action: "graphics_process" });
    graphics.push(g.id!);
  }
  const p = await run({
    action: "package_create",
    id: c.id,
    title: "SIMULATION",
    caption:
      "SIMULATION. Verify the exact caption and media before approval. No real publication.",
    cta: "Review",
    thread: [],
    graphic_ids: graphics,
  });
  await run({ action: "package_approve", id: p.id, confirmed: true });
  state = await readControl(rpc, true);
  let a = state.entities.find(
    (e) => e.kind === "account" && e.data.platform === "x",
  );
  if (!a) {
    await run({
      action: "account_create",
      platform: "x",
      handle: "simulation-only",
    });
    state = await readControl(rpc, true);
    a = state.entities.find(
      (e) => e.kind === "account" && e.data.platform === "x",
    )!;
  }
  await rpc("commit_control", {
    p_epoch: state.epoch,
    p_entities: [
      {
        ...a,
        version: a.version + 1,
        data: {
          ...a.data,
          status: "connected",
          external_id: "simulator-only",
          capabilities: ["publish", "analytics"],
          simulation: "success",
        },
      },
    ],
    p_jobs: [],
    p_public: [],
    p_actor: "SIMULATION fixture",
  });
  return { packageId: p.id!, contentId: c.id!, storyId: story.id };
}
