import { test, expect } from "@playwright/test";
test("public presentation stays visually independent of product UI tokens", async ({
  page,
}) => {
  await page.goto("/about");
  const colors = () =>
    page.locator(".public-frame").evaluate((e) => ({
      background: getComputedStyle(e).backgroundColor,
      color: getComputedStyle(e).color,
      accent: getComputedStyle(e).getPropertyValue("--accent-primary"),
    }));
  const before = await colors();
  await page.evaluate(() => {
    const root = document.documentElement.style;
    root.setProperty("--accent-primary", "#ff00ff");
    root.setProperty("--surface-canvas", "#000000");
    root.setProperty("--text-primary", "#ffffff");
  });
  expect(await colors()).toEqual(before);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
test("private creative commands persist revision-bound scaffolding without generation or distribution", async ({
  page,
  request,
}) => {
  await page.goto("/workbench");
  const command = (command: Record<string, unknown>) =>
    page.evaluate(async (command) => {
      const s = await (await fetch("/api/control")).json();
      const r = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ epoch: s.state.epoch, command }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      return data as { id: string };
    }, command);
  const initial = await (await request.get("/api/control")).json();
  if (
    !initial.state.entities.some(
      (e: { kind: string; data: { status: string } }) =>
        e.kind === "brand" && e.data.status === "active",
    )
  ) {
    const b = await command({
      action: "brand_save",
      name: "TEST only",
      positioning: "Test policy",
      audience: "Test reviewer",
      pillars: ["Test"],
      tone: ["Specific"],
      cta: "Review",
    });
    await command({ action: "brand_approve", id: b.id, confirmed: true });
  }
  const story = initial.stories.find(
    (s: { status: string }) => s.status === "approved",
  );
  const draft = story.drafts.find(
    (d: { id: string }) => d.id === story.active_draft_id,
  );
  const idea = await command({
    action: "idea_create",
    title: "TEST creative boundary",
    source: "story",
    story_id: story.id,
    provenance: "Test fixture only",
  });
  for (const target of ["qualified", "selected"])
    await command({ action: "idea_transition", id: idea.id, target });
  const content = await command({
    action: "content_create",
    idea_id: idea.id,
    platform: "instagram",
    format: "carousel",
    purpose: "Test scaffolding",
  });
  await command({ action: "content_bind", id: content.id, draft_id: draft.id });
  const snapshot = await (await request.get("/api/control")).json();
  const c = snapshot.state.entities.find(
    (e: { id: string }) => e.id === content.id,
  );
  const specification = {
    schema_version: 1,
    grammar_status: "PENDING_C2_CREATIVE_VALIDATION",
    binding: {
      story_id: story.id,
      content_id: c.id,
      content_version: c.version,
      angle_id: draft.angle_id,
      draft_id: draft.id,
      draft_revision: draft.revision,
    },
    brief: {
      schema_version: 1,
      id: crypto.randomUUID(),
      revision: 1,
      objective: "TEST preparation",
      audience: "Test reviewers",
      thesis: "Test version binding",
      exact_copy: { headline: "TEST ONLY" },
      sources: [],
    },
    visual: {
      schema_version: 1,
      visual_thesis: "Test",
      composition: "Supplied later",
      typography: [],
      aspect_ratios: ["4:5"],
      fallback_strategy: "Wait for human direction",
    },
    carousel: {
      schema_version: 1,
      aspect_ratio: "4:5",
      scenes: [
        {
          id: crypto.randomUUID(),
          type: "custom",
          copy: { headline: "TEST ONLY" },
          hierarchy: ["headline"],
          composition: "Fixture, not a final style",
          compositing: {
            schema_version: 1,
            layers: [
              {
                id: crypto.randomUUID(),
                intent: "TEST composition only",
                z_index: 3,
                asset_ids: [],
                copy_key: "headline",
                transformations: [],
              },
            ],
            relationships: [],
            operations: [],
          },
          asset_ids: [],
          typography: [],
          sources: [],
        },
      ],
    },
    captions: [],
    requirements: [],
    assets: [],
    handoffs: [],
  };
  const creative = await command({
    action: "creative_save",
    package: specification,
  });
  const a = await command({
    action: "creative_job_queue",
    id: creative.id,
    operation: "GENERATE_CAROUSEL_SPEC",
  });
  const b = await command({
    action: "creative_job_queue",
    id: creative.id,
    operation: "GENERATE_CAROUSEL_SPEC",
  });
  expect(a.id).toBe(b.id);
  const exported = await request.get(`/api/creative/${creative.id}/handoff`);
  expect(exported.ok()).toBe(true);
  expect(exported.headers()["cache-control"]).toContain("private");
  const data = await exported.json();
  expect(data.brief.exact_copy).toEqual(specification.brief.exact_copy);
  expect(data.publishable).toBe(false);
  expect(data.scenes[0].compositing).toEqual(
    specification.carousel.scenes[0].compositing,
  );
  await command({
    action: "creative_approve",
    id: creative.id,
    confirmed: true,
  });
  specification.brief.revision++;
  specification.carousel.scenes[0].compositing.layers[0].z_index++;
  await command({
    action: "creative_save",
    id: creative.id,
    package: specification,
  });
  const final = await (await request.get("/api/control")).json();
  const revised = final.state.entities.find(
    (e: { id: string }) => e.id === creative.id,
  );
  expect(revised.data.status).toBe("draft");
  expect(revised.data.approval).toBeNull();
  const job = final.state.jobs.find((j: { id: string }) => j.id === a.id);
  expect(job.status).toBe("blocked");
  expect(job.error).toContain("NOT_CONFIGURED");
  expect(
    final.state.entities.filter((e: { kind: string }) => e.kind === "outbox"),
  ).toEqual(
    initial.state.entities.filter((e: { kind: string }) => e.kind === "outbox"),
  );
});
