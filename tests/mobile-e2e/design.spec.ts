import { test, expect } from "@playwright/test";
test("mobile navigation traps focus, closes with Escape and restores the menu trigger", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your editorial desk." }),
  ).toBeVisible();
  const trigger = page.getByRole("button", {
    name: "Toggle navigation",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Workspace navigation",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((e) => e.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog
    .getByRole("link", { name: "Account Activation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Account Activation" }),
  ).toBeVisible();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Quick actions", exact: true }),
  ).toBeVisible();
});
test("390px approval context, studio, newsletter and account summaries remain readable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of [
    "/login",
    "/brief",
    "/stories/00000000-0000-4000-8000-000000000200?tab=drafts",
    "/actions",
    "/production/studio",
    "/activation",
    "/operations-center",
    "/about",
  ]) {
    await page.goto(route);
    await expect(page.locator("h1,h2").first()).toBeVisible();
    await expect(page.locator(".loading")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      route,
    ).toBe(true);
    await expect(page.locator("main")).toHaveCount(1);
  }
  await page.goto("/activation");
  await page.locator('[data-provider="youtube"] summary').first().click();
  await expect(
    page.locator('[data-provider="youtube"] input[name="handle"]'),
  ).toBeVisible();
});
