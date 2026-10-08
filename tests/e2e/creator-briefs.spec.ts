import { expect, test } from "@playwright/test";
test("creator experiment is labeled as briefs with no publication controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/creator-briefs");
  await expect(
    page.getByRole("heading", { name: "Story briefs", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/No son publicaciones listas/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /approve|publicar|aprobar/i }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
