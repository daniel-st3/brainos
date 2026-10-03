import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("exact mobile review renders final media and records all three decisions without social calls", async ({
  page,
  request,
}) => {
  const ids = JSON.parse(await readFile(".data/e2e-approvals.json", "utf8"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/review/${ids.approve}`);
  await expect(
    page.getByRole("heading", { name: "SIMULATION", exact: true }),
  ).toBeVisible();
  const media = page.getByRole("img", { name: /Final approved media/ });
  await expect(media).toBeVisible();
  await expect
    .poll(() => media.evaluate((e) => (e as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/approval-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/approval-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "APPROVE & PUBLISH", exact: true })
    .click();
  await expect(page.getByText(/Decision saved: approve/)).toBeVisible();
  const result = await (
    await request.get(`/api/approvals/${ids.approve}`)
  ).json();
  expect(result.outbox_id).toBeTruthy();
  expect(result.demo).toBe(true);
  expect(result.wait_token_id).toBeUndefined();
  for (const [decision, label] of [
    ["reject", "REJECT"],
    ["request_changes", "REQUEST CHANGES"],
  ]) {
    await page.goto(`/review/${ids[decision]}`);
    await page
      .getByLabel("Notes / requested changes")
      .fill("SIMULATION feedback");
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(
      page.getByText(
        new RegExp(`Decision saved: ${decision.replaceAll("_", " ")}`),
      ),
    ).toBeVisible();
    expect(
      (await (await request.get(`/api/approvals/${ids[decision]}`)).json())
        .outbox_id,
    ).toBeNull();
  }
  const rejected = await request.post(`/api/approvals/${ids.approve}`, {
    headers: { Origin: "https://untrusted.example" },
    data: { decision: "approve" },
  });
  expect(rejected.status()).toBe(403);
});
