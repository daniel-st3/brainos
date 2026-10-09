import { test, expect } from "@playwright/test";
import { neoPolicy } from "../../src/approval/neo-policy";
// Browser-only fixture: every API request is intercepted; no decision reaches a runtime.
test("NEO mobile risk box is unchecked, gates approval and submits explicit acknowledgment", async ({
  page,
}) => {
  const id = "11111111-1111-4111-8111-111111111111";
  let submitted: Record<string, unknown> | undefined;
  const view = {
    id,
    checksum: "a".repeat(64),
    state: "AWAITING_DANIEL",
    decision: null,
    outbox_id: null,
    current: true,
    expired: false,
    demo: true,
    frozen: {
      title: "NEO owner risk fixture",
      caption: "Exact fixture caption",
      platform: "instagram",
      handle: "dvni.ai",
      due_at: null,
      thread: [],
      sources: [],
      media: neoPolicy.media.map((m) => ({ ...m, mime: "image/png" })),
      imported: {
        revision: "NEO-OWNER-RISK-1",
        publication: { kind: neoPolicy.kind },
        manifests: {
          rights: {
            overall_risk: "UNCLEAR",
            rights_clearance: "UNCLEAR",
            conditions: [],
          },
        },
      },
    },
  };
  await page.route("**/api/approvals/**", async (route) => {
    if (route.request().url().includes("/media?"))
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON();
      return route.fulfill({
        status: 409,
        json: { error: "SIMULATION: decision not persisted" },
      });
    }
    return route.fulfill({ json: view });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/review/${id}`);
  const approve = page.getByRole("button", {
      name: "APPROVE & PUBLISH",
      exact: true,
    }),
    ack = page.getByRole("checkbox");
  await expect(ack).not.toBeChecked();
  await expect(approve).toBeDisabled();
  await expect(
    page.getByText(neoPolicy.disclosure, { exact: true }),
  ).toBeVisible();
  await ack.check();
  await expect(approve).toBeEnabled();
  await ack.uncheck();
  await expect(approve).toBeDisabled();
  await ack.check();
  await approve.click();
  await expect
    .poll(() => submitted?.neo_risk_acknowledgment)
    .toBe(neoPolicy.id);
  expect(submitted?.checksum).toBe(view.checksum);
  expect(submitted?.decision).toBe("approve");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/neo-owner-risk-mobile.png",
    fullPage: true,
  });
});
