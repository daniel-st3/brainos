import { test, expect } from "@playwright/test";
test("live brief: evidence, fail-closed workflow, pilot actions and a manual miss", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/brief");
  await expect(page.getByText("1 selected stories · maximum 10")).toBeVisible();
  await expect(
    page.getByText("2 source URLs · 2 retained discoveries"),
  ).toBeVisible();
  await expect(
    page.getByText("TEST · official evidence · Tier 0 · Primary"),
  ).toBeVisible();
  await expect(
    page.getByText("POTENTIAL ANGLE · SYSTEM SUGGESTION"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save / prioritize" }).click();
  await expect(
    page.getByRole("button", { name: "Unsave", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Research next", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Research next", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("link", { name: "Open full story", exact: true })
    .click();
  await expect(page).toHaveURL(/\/stories\//);
  const storyUrl = page.url();
  await page.getByRole("link", { name: "sources 2" }).click();
  await expect(page.getByText("Evidence hash")).toHaveCount(2);
  await expect(page.getByText("PRIMARY SOURCE")).toBeVisible();
  await page.getByRole("link", { name: "claims", exact: true }).click();
  await expect(page.getByText("SUPPORTING EVIDENCE")).toHaveCount(2);
  await page.getByRole("button", { name: "Mark verified" }).click();
  await expect(page.locator(".form-error[role=alert]")).toContainText(
    "primary evidence",
  );
  await page.getByRole("link", { name: "assets", exact: true }).click();
  await expect(
    page.locator("dd").filter({
      hasText: "Unknown. Presence in a public feed is not a license.",
    }),
  ).toBeVisible();
  const stories = await (await request.get("/api/newsroom")).json();
  expect(stories).toHaveLength(1);
  expect(stories[0].status).toBe("detected");
  expect(stories[0].assets[0].publishable).toBe(false);
  const shortcut = await request.post("/api/commands", {
    headers: { Origin: "http://localhost:3101" },
    data: {
      storyId: stories[0].id,
      expectedVersion: stories[0].version,
      command: { type: "transition", target: "approved" },
    },
  });
  expect(shortcut.status()).toBe(422);
  await page.goto("/pilot");
  const row = page.locator("tr").filter({
    has: page.getByRole("link", {
      name: "TEST FIXTURE — Product API launch",
    }),
  });
  await expect(row).toContainText("Rank 1");
  await expect(row).toContainText("Yes");
  await page.goto("/brief");
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.getByText("No recent live discoveries yet")).toBeVisible();
  await page.getByText("The system missed a story", { exact: true }).click();
  await page
    .getByLabel("Story headline")
    .fill("TEST FIXTURE — Missed discovery");
  await page
    .getByLabel("Original story URL")
    .fill("https://missed.example/announcement?utm_source=manual");
  await page
    .getByLabel("Why did this deserve discovery?")
    .fill("Manual browsing found a useful candidate.");
  await page.getByRole("button", { name: "Save missed story" }).click();
  await expect(
    page.getByRole("heading", {
      name: "TEST FIXTURE — Missed discovery",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Manually supplied lead; source contents have not yet been retrieved.",
    ),
  ).toBeVisible();
  await page.goto("/pilot");
  await expect(
    page.getByRole("link", { name: "TEST FIXTURE — Missed discovery" }),
  ).toBeVisible();
  await page.goto(storyUrl);
  await expect(
    page.getByRole("heading", { name: "TEST FIXTURE — Product API launch" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("live routes fit mobile and report source failures without runtime errors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/", "/brief", "/inbox", "/sources", "/pilot"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});
