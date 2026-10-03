import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
let bundle: string;
test.beforeAll(async () => {
  const output = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AccountActivation} from './src/components/account-activation';
const providers=['instagram','tiktok','youtube','beehiiv','x'].map((platform,i)=>({platform,engineering:'CONNECTED',signup:'https://example.invalid',app_configured:true,free_connector:i<2,transport:i<2?'buffer':'native',profile:null,drift:{status:'UNKNOWN',fields:[]},capabilities:i<2?['profile_read','publish','media_upload','schedule']:platform==='youtube'?['profile_read','media_upload','analytics']:platform==='beehiiv'?['profile_read','analytics','subscriber_read','posts_read']:[],blocker:platform==='youtube'?'YOUTUBE_PROJECT_AUDIT_PRIVATE_ONLY':platform==='beehiiv'?'BEEHIIV_POSTS_PLAN_ACCESS_REQUIRED':platform==='x'?'BLOCKED_ACCOUNT_RECOVERY':null,account:platform==='x'?null:{id:'fixture-'+platform,kind:'account',version:1,is_demo:false,data:{platform,status:'connected',creation_state:'created',handle:platform==='youtube'?'dvni_ai':platform==='beehiiv'?'DVNI':'dvni.ai',external_id:'fixture-channel-'+platform,verified_at:new Date().toISOString(),writes_authorized:false,choices:[]}}}));
const state={entities:[],jobs:[],epoch:1,workers:[],providers,distribution:[],launch_slots:[]};window.commands=[];window.fetch=async(url,init)=>{if(init?.method==='POST'){window.commands.push(JSON.parse(init.body));return new Response(JSON.stringify({}),{status:200});}return new Response(JSON.stringify(state),{status:200});};createRoot(document.getElementById('root')).render(<AccountActivation initial={state}/>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "fixture-link",
        setup(p) {
          p.onResolve({ filter: /^next\/link$/ }, () => ({
            path: "next/link",
            namespace: "fixture",
          }));
          p.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "import {createElement} from 'react';export default function Link(p){return createElement('a',p,p.children)}",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  bundle = output.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (r) => r.abort());
  await page.setContent('<main id="main-content"><div id="root"></div></main>');
  await page.addStyleTag({
    content:
      readFileSync("src/app/globals.css", "utf8") +
      readFileSync("src/app/design-system.css", "utf8"),
  });
  await page.addScriptTag({ content: bundle });
});
test("real-state fixtures keep YouTube and beehiiv connected while send capabilities stay blocked", async ({
  page,
}) => {
  for (const platform of ["youtube", "beehiiv"]) {
    const provider = page.locator('[data-provider="' + platform + '"]');
    await expect(provider.locator(".provider-heading .status-chip")).toHaveText(
      "Connected",
    );
    await expect(provider.getByText("Disabled", { exact: true })).toBeVisible();
  }
  await expect(
    page.locator('[data-provider="youtube"] .provider-capabilities'),
  ).toContainText("Private upload");
  await expect(
    page.getByText("Public uploads require Google audit", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Sending unavailable on current plan", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("AUTH_REQUIRED", { exact: true })).toHaveCount(0);
  await expect(page.getByText("READY_FOR_AUTH", { exact: true })).toHaveCount(
    0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const x = page.locator('[data-provider="x"]');
  await x
    .getByText("Connection, permissions & profile", { exact: true })
    .click();
  await expect(
    x.getByRole("button", { name: "Registrar cuenta creada", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => (window as unknown as { commands: unknown[] }).commands,
    ),
  ).toEqual([]);
});
test("account send authorization still requires a fresh explicit confirmation and preserves exact payload", async ({
  page,
}) => {
  const provider = page.locator('[data-provider="instagram"]');
  await provider
    .getByText("Connection, permissions & profile", { exact: true })
    .click();
  const button = provider.getByRole("button", {
    name: "Autorizar envíos de esta cuenta",
    exact: true,
  });
  await expect(button).toBeDisabled();
  await provider
    .getByRole("checkbox", { name: /Autorizo futuros envíos/ })
    .check();
  await button.click();
  await expect(button).toBeDisabled();
  expect(
    await page.evaluate(
      () => (window as unknown as { commands: unknown[] }).commands,
    ),
  ).toEqual([
    {
      action: "distribution_authorize",
      id: "fixture-instagram",
      enabled: true,
      confirmed: true,
    },
  ]);
});
