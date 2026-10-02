import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Workbench } from "../src/components/control-workbench";
import type { ControlState } from "../src/control/model";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=content"),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => createElement("a", props, children),
}));

function render(
  options: {
    transport?: string;
    approval?: boolean;
    accountStatus?: string;
    publish?: boolean;
    demo?: boolean;
    version?: number;
  } = {},
) {
  const contentId = crypto.randomUUID(),
    packageId = crypto.randomUUID(),
    accountId = crypto.randomUUID(),
    demo = options.demo ?? false;
  const state: ControlState = {
    epoch: 1,
    workers: [],
    jobs: [],
    events: [],
    entities: [
      {
        id: contentId,
        kind: "content",
        version: 1,
        story_id: null,
        draft_id: null,
        parent_id: null,
        is_demo: demo,
        data: {
          title: "Approved fixture",
          platform: "x",
          format: "post",
          quality_issues: [],
          final_approval:
            options.approval === false
              ? null
              : {
                  package_id: packageId,
                  package_version: 2,
                  fingerprint: "exact-fingerprint",
                },
        },
      },
      {
        id: packageId,
        kind: "package",
        version: options.version ?? 2,
        story_id: null,
        draft_id: null,
        parent_id: contentId,
        is_demo: demo,
        data: {
          title: "Approved package",
          platform: "x",
          caption: "Approved copy",
          thread: [],
          status: "approved",
          graphic_ids: [],
          fingerprint: "exact-fingerprint",
        },
      },
      {
        id: accountId,
        kind: "account",
        version: 1,
        story_id: null,
        draft_id: null,
        parent_id: null,
        is_demo: demo,
        data: {
          platform: "x",
          delivery_transport: options.transport ?? "buffer",
          status: options.accountStatus ?? "connected",
          handle: "fixture-account",
          capabilities: options.publish === false ? [] : ["publish"],
        },
      },
    ],
  };
  return renderToStaticMarkup(
    createElement(Workbench, {
      state,
      stories: [],
      production: { packages: [], jobs: [], batches: [] },
      accounts: [
        {
          id: accountId,
          platform: "x",
          status: options.accountStatus ?? "connected",
          handle: "fixture-account",
          capabilities: ["publish"],
          reason: null,
        },
      ],
      campaigns: [],
    }),
  );
}

it("offers Buffer controls only for a live connected Buffer channel and the exact final-approved package", () => {
  expect(render()).toContain("Deliver with Buffer");
  for (const options of [
    { transport: "native" },
    { approval: false },
    { version: 3 },
    { demo: true },
    { accountStatus: "revoked" },
    { publish: false },
  ])
    expect(render(options)).not.toContain("Deliver with Buffer");
});
it("keeps private native handoff alongside Buffer and never pre-authorizes an external action", () => {
  const html = render();
  expect(html).toContain("Download native handoff");
  expect(html).toContain("Create Buffer draft");
  expect(html).toContain(
    "Buffer actions remain blocked until Daniel enables it",
  );
  expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
  expect(html).toContain('href="/activation#distribution"');
});
