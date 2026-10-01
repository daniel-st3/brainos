import { test, expect } from "@playwright/test";
const story = "/stories/00000000-0000-4000-8000-000000000200";
test("editorial package: evidence, blocked clearance, revision approval, production, internal schedule, invalidation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your editorial desk." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Story Inbox", exact: true }).click();
  await page.getByLabel("Search stories").fill("meeting assistant");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page
    .getByRole("link", {
      name: "Can a meeting assistant earn its place in the stack?",
      exact: true,
    })
    .click();
  await page.getByRole("link", { name: "sources 2" }).click();
  await expect(
    page.getByText("Original demo scenario · not external reporting"),
  ).toBeVisible();
  await page.getByRole("link", { name: "claims", exact: true }).click();
  await expect(page.getByText("SUPPORTING EVIDENCE")).toBeVisible();
  await page.getByRole("link", { name: "angles", exact: true }).click();
  await expect(page.getByText("AI suggestion", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Approved by Daniel", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "drafts 2" }).click();
  await expect(
    page.getByRole("heading", { name: "Instagram v2" }),
  ).toBeVisible();
  await page.getByText("Instagram · v1", { exact: true }).click();
  await expect(
    page.getByText("Primero el proceso. Después, la herramienta.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Third-party product screenshot").check();
  await page.getByRole("button", { name: "Save as new revision" }).click();
  await expect(
    page.getByRole("heading", { name: "Instagram v3" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check asset clearance" }).click();
  await expect(page.locator(".form-error[role=alert]")).toContainText(
    "unknown rights",
  );
  await page.getByLabel("Third-party product screenshot").uncheck();
  await page.getByRole("button", { name: "Save as new revision" }).click();
  await expect(
    page.getByRole("heading", { name: "Instagram v4" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check asset clearance" }).click();
  await expect(
    page.getByRole("button", { name: "Move to production" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Move to production" }).click();
  await expect(
    page.getByRole("button", { name: "Send for review" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send for review" }).click();
  await page.getByRole("link", { name: "Open review queue" }).click();
  await page
    .getByRole("checkbox", { name: /I reviewed this exact copy/ })
    .check();
  await page.getByRole("button", { name: "Approve exact revision v4" }).click();
  await expect(
    page.getByRole("heading", { name: "Your review desk is clear" }),
  ).toBeVisible();
  await page.goto("/production");
  const production = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Can a meeting assistant earn its place in the stack?",
    }),
  });
  await production.getByLabel("Script / copy checked").check();
  await production.getByLabel("Copy proofread for output").check();
  await production
    .getByLabel("Selected visuals and attribution prepared")
    .check();
  await production
    .getByRole("button", { name: "Save production checklist" })
    .click();
  await expect(
    production.getByText("Preparation complete", { exact: true }),
  ).toBeVisible();
  await page.goto("/publish");
  const publication = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Can a meeting assistant earn its place in the stack?",
    }),
  });
  await expect(publication).toContainText("APPROVED v4");
  await publication
    .getByLabel("Destination", { exact: true })
    .fill("Daniel · Instagram");
  await publication.getByLabel("Scheduled time").fill("2027-01-01T10:00");
  await publication
    .getByRole("button", { name: "Save internal schedule" })
    .click();
  await expect(publication).toContainText("scheduled internal");
  await expect(publication).toContainText("Integration required");
  await page.goto(story + "?tab=drafts");
  await page
    .getByLabel("Hook", { exact: true })
    .fill("An edited hook after approval");
  await page.getByRole("button", { name: "Save as new revision" }).click();
  await expect(
    page.getByRole("heading", { name: "Instagram v5" }),
  ).toBeVisible();
  await expect(page.locator(".draft-editor")).toContainText("draft");
  await page.goto("/publish");
  await expect(
    page.getByRole("heading", {
      name: "Can a meeting assistant earn its place in the stack?",
    }),
  ).toHaveCount(0);
  await page.goto(story + "?tab=activity");
  await expect(
    page.getByText("Revision 4 preserved; edits need fresh approval."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("server rejects shortcuts, stale revisions and cross-origin writes", async ({
  request,
}) => {
  const stories = await (await request.get("/api/newsroom")).json();
  const s = stories[0];
  const payload = {
    storyId: s.id,
    expectedVersion: s.version,
    command: { type: "transition", target: "approved" },
  };
  const forbidden = await request.post("/api/commands", {
    data: payload,
    headers: {
      Origin: `http://localhost:${Number(process.env.E2E_PORT_BASE ?? 3100)}`,
    },
  });
  expect(forbidden.status()).toBe(422);
  const stale = await request.post("/api/commands", {
    data: {
      ...payload,
      expectedVersion: s.version + 99,
      command: { type: "prioritize" },
    },
    headers: {
      Origin: `http://localhost:${Number(process.env.E2E_PORT_BASE ?? 3100)}`,
    },
  });
  expect(stale.status()).toBe(409);
  const cross = await request.post("/api/commands", {
    data: payload,
    headers: { Origin: "https://untrusted.example" },
  });
  expect(cross.status()).toBe(403);
});
test("main routes work on mobile without document overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "/",
    "/inbox",
    "/brief",
    story,
    story + "?tab=assets",
    "/review",
    "/production",
    "/publish",
  ]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Story Inbox", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Signals worth a closer look." }),
  ).toBeVisible();
});

test("detected story advances through human research and mock generation into recording", async ({
  page,
}) => {
  const path = "/stories/00000000-0000-4000-8000-000000000100";
  await page.goto(path + "?tab=claims");
  await page.getByRole("button", { name: "Mark verified" }).click();
  await expect(page.locator(".form-error[role=alert]")).toContainText(
    "primary evidence",
  );
  await page
    .getByText("Record a human evidence check", { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Verification", exact: true })
    .selectOption("supported");
  await page
    .getByLabel("Verification notes")
    .fill(
      "Checked against the original fictional scenario, not a live news claim.",
    );
  await page.getByRole("button", { name: "Save evidence check" }).click();
  await expect(page.locator(".claim-panel .rights")).toHaveText("supported");
  await page.getByRole("button", { name: "Mark verified" }).click();
  await expect(
    page.getByRole("button", { name: "Complete research" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "research", exact: true }).click();
  await page
    .getByLabel("Structured notes")
    .fill(
      "Demo research checked. No live release, availability or performance is asserted.",
    );
  await page
    .getByRole("checkbox", { name: /I checked the source evidence/ })
    .check();
  await page.getByRole("button", { name: "Save research notes" }).click();
  await expect(
    page.getByRole("button", { name: "Save research notes" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Complete research" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm angle selection" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "angles", exact: true }).click();
  await page
    .getByRole("button", { name: "Approve this angle" })
    .first()
    .click();
  await expect(page.getByText("Confirmed for this story only")).toBeVisible();
  await page.getByRole("button", { name: "Confirm angle selection" }).click();
  await page.getByRole("link", { name: "Create a draft", exact: true }).click();
  await page.getByLabel("Target format").selectOption("short_video");
  await page.getByRole("button", { name: "Generate demo draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Short video v1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check asset clearance" }).click();
  await page.getByRole("button", { name: "Move to production" }).click();
  await expect(page.locator(".workflow-next .status")).toHaveText(
    "Recording needed",
  );
  await page.goto("/production");
  await expect(
    page.getByRole("heading", {
      name: "An AI release is only useful if it changes the workflow",
    }),
  ).toBeVisible();
});
