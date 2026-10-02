import { test, expect } from "@playwright/test";
test("mobile editorial controls, action queue, production and launch stay usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const path of [
    "/login",
    "/brief",
    "/stories/00000000-0000-4000-8000-000000000200?tab=claims",
    "/stories/00000000-0000-4000-8000-000000000200?tab=angles",
    "/stories/00000000-0000-4000-8000-000000000200?tab=drafts",
    "/actions",
    "/production/studio",
    "/workbench?tab=launch",
    "/about",
  ]) {
    await page.goto(path);
    await expect(page.locator("h1,h2").first()).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      path,
    ).toBe(true);
  }
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /My Actions/ })).toBeVisible();
  expect(errors).toEqual([]);
});
test("public consent intake works and does not reveal private records", async ({
  page,
}) => {
  await page.goto("/about");
  await expect(
    page.getByRole("link", { name: "Story Inbox", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Email", { exact: true })
    .fill("mobile-demo@example.com");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Guardar mi interés" }).click();
  await expect(page.getByRole("status")).toContainText("Consent saved");
  await page.getByRole("button", { name: "Retirar consentimiento" }).click();
  await expect(page.getByRole("status")).toContainText("retirado");
});
