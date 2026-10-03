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
    "/activation",
    "/operations-center",
    "/opportunities",
    "/contact",
    "/privacy",
    "/terms",
    "/recording-demo",
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

test("connected-account identifiers and capability blockers fit activation at 390px", async ({
  page,
}) => {
  await page.goto("/activation");
  await page
    .locator(".account-activation .panel")
    .first()
    .evaluate((panel) => {
      const status = document.createElement("p");
      status.textContent =
        "BEEHIIV_POSTS_PLAN_ACCESS_REQUIRED · pub_00000000-0000-4000-8000-000000000001";
      panel.append(status);
    });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("activation, safe demo, PNG share and install manifest have safe boundaries", async ({
  page,
  request,
}) => {
  await page.goto("/activation");
  await expect(
    page.getByRole("heading", { name: "Account Activation" }),
  ).toBeVisible();
  await page.goto("/recording-demo");
  await expect(page.getByText("DEMO / FICTIONAL FIXTURES")).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(
    /@[a-z0-9.-]+\.[a-z]+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
  );
  const og = await request.get("/api/public/share");
  expect(og.headers()["content-type"]).toContain("image/png");
  expect((await og.body()).subarray(1, 4).toString()).toBe("PNG");
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  await page.goto("/contact");
  await page.getByLabel("Nombre", { exact: true }).fill("DEMO request");
  await page
    .getByLabel("Email", { exact: true })
    .fill("demo-intake@example.com");
  await page
    .getByLabel("Problema, caso de uso o invitación")
    .fill("Clearly fictional testing request");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Enviar solicitud" }).click();
  await expect(page.getByRole("status")).toContainText("guardada");
  await page.goto("/about");
  expect(await page.locator("body").innerText()).not.toContain(
    "demo-intake@example.com",
  );
  expect(
    await page.locator('meta[name="robots"]').getAttribute("content"),
  ).toContain("noindex");
});
