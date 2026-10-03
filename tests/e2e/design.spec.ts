import { test, expect } from "@playwright/test";
const story = "/stories/00000000-0000-4000-8000-000000000200";
test("editorial shell preserves routes, selected navigation and dossier tabs", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your editorial desk." }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      ui: getComputedStyle(document.body).fontFamily,
      editorial: getComputedStyle(document.querySelector("h1")!).fontFamily,
      uiVar: root.getPropertyValue("--font-ui"),
      displayVar: root.getPropertyValue("--font-editorial"),
      loaded: Array.from(document.fonts)
        .filter((f) => f.status === "loaded")
        .map((f) => f.family),
    };
  });
  const family = (value: string) =>
    value.split(",")[0].trim().replace(/["']/g, "");
  expect(family(fonts.ui)).toBe(family(fonts.uiVar));
  expect(family(fonts.editorial)).toBe(family(fonts.displayVar));
  expect(fonts.ui).not.toBe(fonts.editorial);
  expect(fonts.loaded.map(family)).toContain(family(fonts.uiVar));
  expect(fonts.loaded.map(family)).toContain(family(fonts.displayVar));
  const nav = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  for (const name of [
    "Story Inbox",
    "Account Activation",
    "Production Studio",
    "My Actions",
    "Operations",
  ])
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "Morning brief", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "What deserves your attention?" }),
  ).toBeVisible();
  await expect(page.locator(".brief-lead")).toHaveCount(1);
  await expect(
    nav.getByRole("link", { name: "Morning brief", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.goto(story + "?tab=angles");
  await expect(
    page.getByRole("link", { name: "angles", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("AI suggestion", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Approved by Daniel", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("#main-content")).toHaveCount(1);
});
test("integration control center reveals forms deliberately and retains confirmation boundaries", async ({
  page,
}) => {
  await page.goto("/activation");
  await expect(
    page.getByRole("heading", { name: "Account Activation" }),
  ).toBeVisible();
  await expect(page.locator(".provider-panel")).toHaveCount(5);
  const yt = page.locator('[data-provider="youtube"]');
  await expect(yt.getByText("Connection", { exact: true })).toBeVisible();
  await expect(yt.getByText("Capabilities", { exact: true })).toBeVisible();
  await expect(yt.locator(".provider-details")).not.toHaveAttribute("open", "");
  await yt
    .getByText("Connection, permissions & profile", { exact: true })
    .click();
  await expect(yt.getByLabel("Handle de la cuenta creada")).toBeVisible();
  await page
    .getByText("Buffer · API key & channel discovery", { exact: true })
    .click();
  await expect(
    page.getByLabel("API key privada de Buffer", { exact: true }),
  ).toHaveAttribute("type", "password");
  await expect(
    page.getByLabel("API key privada de Buffer", { exact: true }),
  ).toHaveValue("");
});
test("public editorial surface keeps private navigation absent and honors reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main navigation", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "DVNI home", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Newsletter", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Newsletter", exact: true }).click();
  await expect(page.locator("#newsletter")).toBeInViewport();
  const styles = await page.locator("#newsletter").evaluate((e) => ({
    opacity: getComputedStyle(e).opacity,
    animation: getComputedStyle(e).animationName,
  }));
  expect(styles.opacity).toBe("1");
  expect(styles.animation).toBe("none");
});
test("critical workspaces stay within tablet and wide desktop viewports", async ({
  page,
}) => {
  for (const width of [768, 1920]) {
    await page.setViewportSize({ width, height: 1080 });
    for (const route of [
      "/brief",
      story + "?tab=claims",
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
        route + " at " + width,
      ).toBe(true);
    }
  }
});
