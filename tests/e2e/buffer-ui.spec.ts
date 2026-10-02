import { test, expect } from "@playwright/test";
import { build } from "esbuild";

// Real React/browser interactions with an in-memory command receiver. No
// account connection or provider request is needed to verify consent behavior.
let bundle: string;
test.use({ timezoneId: "America/Bogota" });
test.beforeAll(async () => {
  const output = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from "react";
import { createRoot } from "react-dom/client";
import { BufferDeliveryForm } from "./src/components/control-workbench";
window.commands = [];
window.rejectCommand = false;
createRoot(document.getElementById("root")).render(<BufferDeliveryForm packageId="00000000-0000-4000-8000-000000000001" packageVersion={7} destination="x · fixture-account" busy={false} send={async command => {
  window.commands.push(command);
  return window.rejectCommand ? null : {status:"processing", remote_status:command.mode === "draft" ? "draft" : "scheduled"};
}} />);`,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "native-link-fixture",
        setup(plugin) {
          plugin.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: "fixture",
          }));
          plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents:
              args.path === "next/link"
                ? `import {createElement} from 'react'; export default function Link(props){ return createElement('a',props,props.children); }`
                : `export function useRouter(){ return {refresh(){}}; } export function useSearchParams(){ return new URLSearchParams(); }`,
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  bundle = output.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(
    page.getByRole("heading", { name: "Deliver with Buffer" }),
  ).toBeVisible();
});

test("each Buffer action requires fresh confirmation and only sends its approved package selection", async ({
  page,
}) => {
  const button = page.getByRole("button", {
    name: "Create Buffer draft",
    exact: true,
  });
  await expect(button).toBeDisabled();
  await page.getByRole("checkbox").check();
  await button.click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(button).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("processing / draft");
  expect(
    await page.evaluate(
      () => (window as unknown as { commands: unknown[] }).commands,
    ),
  ).toEqual([
    {
      action: "buffer_delivery",
      package_id: "00000000-0000-4000-8000-000000000001",
      mode: "draft",
      confirmed: true,
    },
  ]);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("combobox", { name: "Buffer action", exact: true })
    .selectOption("now");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Send now through Buffer", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Send now through Buffer", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      (window as unknown as { commands: { mode: string }[] }).commands.map(
        (c) => c.mode,
      ),
    ),
  ).toEqual(["draft", "now"]);
});
test("scheduling validates local time and a time change clears prior consent", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Buffer action", exact: true })
    .selectOption("schedule");
  const date = page.getByLabel("Scheduled date and time (your local time)");
  await date.fill("2000-01-02T10:00");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Programar en BrainOS", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Choose a future date and time before scheduling.",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { commands: unknown[] }).commands,
    ),
  ).toEqual([]);
  await date.fill("2099-01-02T10:00");
  await page.getByRole("checkbox").check();
  await date.fill("2099-01-02T11:00");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Programar en BrainOS", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as { commands: unknown[] }).commands,
    ),
  ).toEqual([
    {
      action: "buffer_delivery",
      package_id: "00000000-0000-4000-8000-000000000001",
      mode: "schedule",
      scheduled_at: "2099-01-02T16:00:00.000Z",
      confirmed: true,
    },
  ]);
});
test("queue consent is specific and a rejected action never claims a successful outcome", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Buffer action", exact: true })
    .selectOption("queue");
  await page
    .getByLabel("Scheduled date and time (your local time)")
    .fill("2099-01-02T10:00");
  await expect(
    page.getByText(/authorize BrainOS to add this approved post/),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { rejectCommand: boolean }).rejectCommand = true;
  });
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Cola de BrainOS (elige fecha)", exact: true })
    .click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as unknown as { commands: { mode: string }[] }).commands.map(
        (c) => c.mode,
      ),
    ),
  ).toEqual(["queue"]);
});
