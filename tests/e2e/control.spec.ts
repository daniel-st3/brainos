import { test, expect } from "@playwright/test";
test("persistent content workflow, honest launch/account blocking and real graphics download", async ({
  page,
}) => {
  await page.goto("/workbench?tab=brand");
  const brand = page.locator("form").filter({
    has: page.getByRole("heading", {
      name: "New brand revision",
      exact: true,
    }),
  });
  await brand
    .getByLabel("Positioning", { exact: true })
    .fill("DEMO: applied AI, evidence first");
  await brand.getByLabel("Audience", { exact: true }).fill("DEMO operators");
  await brand.getByLabel("Pillars, one per line").fill("AI at work");
  await brand
    .getByLabel("Tone principles, one per line")
    .fill("Specific\nMeasured");
  await brand.getByLabel("Preferred CTA").fill("Inspect the source");
  await brand.getByRole("button", { name: "Save", exact: true }).click();
  const approval = page
    .locator("form")
    .filter({
      has: page.getByRole("heading", {
        name: "Approve brand revision",
        exact: true,
      }),
    })
    .last();
  await approval.getByRole("checkbox").check();
  await approval.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("active", { exact: true })).toBeVisible();
  const command = async (data: Record<string, unknown>) =>
    page.evaluate(async (command) => {
      const s = await (await fetch("/api/control")).json();
      const r = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ epoch: s.state.epoch, command }),
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.error);
      return body as { id: string };
    }, data);
  const state = await page.evaluate(
      async () => await (await fetch("/api/control")).json(),
    ),
    story = state.stories.find(
      (s: { status: string }) => s.status === "approved",
    );
  const idea = await command({
    action: "idea_create",
    title: "DEMO launch workflow",
    source: "story",
    story_id: story.id,
    provenance: "Fictional scenario, not external reporting",
  });
  for (const target of ["qualified", "selected"])
    await command({ action: "idea_transition", id: idea.id, target });
  const c = await command({
    action: "content_create",
    idea_id: idea.id,
    platform: "x",
    format: "post",
    purpose: "DEMO state and approval proof",
  });
  await command({
    action: "content_bind",
    id: c.id,
    draft_id: story.active_draft_id,
  });
  await command({
    action: "content_freshness",
    id: c.id,
    evergreen: true,
    fresh_until: null,
    confirmed: true,
  });
  for (const target of ["review", "approved"])
    await command({
      action: "content_transition",
      id: c.id,
      target,
      confirmed: true,
    });
  const g = await command({
    action: "graphic_queue",
    content_id: c.id,
    template: "cover",
    aspect: "9:16",
    headline: "DEMO: measure the workflow",
    text: "A proposal, not an observed result.",
    source_ids: [story.sources[0].id],
    slides: [],
  });
  await command({ action: "graphics_process" });
  await command({
    action: "graphic_clear",
    id: g.id,
    basis: "Original DEMO typographic composition",
    scope: "x",
    confirmed: true,
  });
  const svg = await page.request.get(`/api/control/graphics/${g.id}`);
  expect(svg.status()).toBe(200);
  expect(await svg.text()).toContain("<svg");
  const p = await command({
    action: "package_create",
    id: c.id,
    title: "DEMO: measure the workflow",
    caption: "DEMO: choose a task, then define how to assess it.",
    cta: "Inspect the source",
    thread: [],
    graphic_ids: [g.id],
  });
  await command({ action: "package_approve", id: p.id, confirmed: true });
  await command({
    action: "content_final",
    id: c.id,
    package_id: p.id,
    confirmed: true,
  });
  await command({
    action: "distribution_queue",
    package_id: p.id,
    due_at: new Date().toISOString(),
    confirmed: true,
  });
  await command({
    action: "campaign_create",
    name: "DEMO launch readiness",
    content_ids: [c.id],
  });
  await command({
    action: "publication_demo",
    package_id: p.id,
    confirmed: true,
  });
  await page.goto("/workbench?tab=launch");
  await expect(page.getByText("x: not_created", { exact: true })).toBeVisible();
  await page.goto("/workbench?tab=operations");
  await expect(
    page.getByRole("heading", { name: "distribution · blocked", exact: true }),
  ).toBeVisible();
  await page.goto("/about");
  await expect(page.getByText("DEMO launch workflow")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Newsletter", exact: true }),
  ).toBeVisible();
});
