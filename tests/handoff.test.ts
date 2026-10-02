import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createDemoStories } from "../src/domain/seed";
import type { Story } from "../src/domain/types";
import {
  packageFingerprint,
  type Content,
  type ControlState,
  type Entity,
  type Package,
} from "../src/control/model";
import type { StudioState } from "../src/production/types";
import type { Rpc } from "../src/ingestion/store";
import {
  nativeHandoff,
  nativeHandoffAsset,
  renderNativeHandoff,
} from "../src/providers/handoff";
import { GET, POST } from "../src/app/api/control/handoff/route";
import { editor } from "../src/server/auth";
import { applicationRpc } from "../src/ingestion/store";
import { rasterBytes } from "../src/providers/raster";

vi.mock("../src/server/auth", () => ({ editor: vi.fn() }));
vi.mock("../src/ingestion/store", () => ({ applicationRpc: vi.fn() }));
vi.mock("../src/server/mode", () => ({ dataMode: () => "demo" }));
vi.mock("../src/providers/raster", () => ({ rasterBytes: vi.fn() }));

const origin = "http://localhost:3000";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let state: ControlState,
  stories: Story[],
  production: StudioState,
  c: Entity<Content>,
  p: Entity<Package>,
  rpc: Rpc;
function entity<T>(
  kind: Entity["kind"],
  data: T,
  parent_id: string | null = null,
): Entity<T> {
  return {
    id: crypto.randomUUID(),
    version: 1,
    kind,
    is_demo: true,
    story_id: stories[0].id,
    draft_id: stories[0].active_draft_id,
    parent_id,
    data,
  };
}
function approve() {
  p.data.fingerprint = packageFingerprint(
    c,
    stories[0].drafts.find((d) => d.id === c.draft_id)!,
    production,
    state.entities.filter((e) => p.data.graphic_ids.includes(e.id)),
  );
  c.data.final_approval = {
    package_id: p.id,
    package_version: p.version,
    fingerprint: p.data.fingerprint,
    actor: "human reviewer",
    at: "2026-01-01T00:00:00Z",
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CONTENT_OS_ORIGIN", origin);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValue(Error("External HTTP forbidden in a handoff export")),
  );
  stories = [createDemoStories().find((s) => s.status === "approved")!];
  const draft = stories[0].drafts.find(
    (d) => d.id === stories[0].active_draft_id,
  )!;
  production = { packages: [], jobs: [], batches: [] };
  const brand = entity("brand", {
    status: "active",
    language: "es",
    name: "Fixture brand",
  });
  c = entity<Content>("content", {
    title: "DEMO approved evidence",
    pillar: "Research",
    purpose: "Fixture",
    platform: "x",
    format: "post",
    language: "es",
    angle_id: draft.angle_id,
    take_id: null,
    owner: "human",
    content_state: "approved",
    production_state: "not_required",
    distribution_state: "ready",
    analytics_state: "pending",
    draft_revision: draft.revision,
    production_id: null,
    fresh_until: null,
    evergreen: true,
    claims_reviewed_at: "2026-01-01T00:00:00Z",
    revalidation_required: false,
    final_approval: null,
    quality_issues: [],
  });
  p = entity<Package>(
    "package",
    {
      status: "approved",
      content_id: c.id,
      content_version: c.version,
      draft_id: draft.id,
      draft_revision: draft.revision,
      brand_id: brand.id,
      brand_version: brand.version,
      platform: "x",
      caption: "DEMO: review the evidence.",
      title: "DEMO approved title",
      cta: "Read the source",
      thread: [],
      source_links: ["https://example.com/source"],
      attribution: {
        text: "Example publisher — https://example.com/source",
        links: ["https://example.com/source"],
        publishers: ["Example publisher"],
        source_card_refs: ["PRIVATE-NOTE"],
        version: "public-attribution/1",
      },
      media_id: null,
      duration: null,
      aspect: null,
      language: "es",
      subtitles: null,
      graphic_ids: [],
      fingerprint: "",
      approved_by: "human reviewer",
      approved_at: "2026-01-01T00:00:00Z",
    },
    c.id,
  );
  state = {
    epoch: 1,
    entities: [brand, c, p] as Entity[],
    jobs: [],
    events: [],
    workers: [],
  };
  approve();
  rpc = vi.fn(async (name) => {
    if (name === "read_control") return structuredClone(state);
    if (name === "read_newsroom") return structuredClone(stories);
    if (name === "read_production") return structuredClone(production);
    throw Error("Unexpected write or provider RPC: " + name);
  }) as Rpc;
  vi.mocked(editor).mockResolvedValue("human reviewer");
  vi.mocked(applicationRpc).mockResolvedValue(rpc);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function bundle() {
  return nativeHandoff(rpc, p.id, p.version, true, origin);
}
function request(
  body: unknown = {
    package_id: p.id,
    package_version: p.version,
    format: "json",
  },
  requestOrigin = origin,
) {
  return new Request(origin + "/api/control/handoff", {
    method: "POST",
    headers: {
      origin: requestOrigin,
      host: "localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
function graphic() {
  const g = entity(
    "graphic",
    {
      status: "rendered",
      rights: "cleared",
      publishable: true,
      content_revision: c.data.draft_revision,
      scope: "x",
      sha256: sha("all slides"),
      outputs: [0, 1].map((slide) => ({
        slide,
        sha256: sha(`svg ${slide}`),
        png: {
          sha256: sha(`image ${slide}`),
          source_svg_sha256: sha(`svg ${slide}`),
        },
      })),
    },
    c.id,
  );
  state.entities.push(g);
  p.data.graphic_ids = [g.id];
  approve();
  return g;
}

it("exports exact approved copy without an account connection, state writes, or external HTTP", async () => {
  const before = structuredClone(state),
    result = await bundle();
  expect(result).toMatchObject({
    title: p.data.title,
    caption: p.data.caption,
    cta: p.data.cta,
    attribution: p.data.attribution!.text,
    package_id: p.id,
    package_version: p.version,
    final_human_action_required: true,
    publication_status: "not_submitted",
  });
  expect(state).toEqual(before);
  expect(
    vi
      .mocked(rpc)
      .mock.calls.map(([name]) => name)
      .sort(),
  ).toEqual(["read_control", "read_newsroom", "read_production"]);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["missing", "package", "version", "fingerprint"])(
  "blocks a %s final approval",
  async (change) => {
    if (change === "missing") c.data.final_approval = null;
    else if (change === "package")
      c.data.final_approval!.package_id = crypto.randomUUID();
    else if (change === "version") c.data.final_approval!.package_version++;
    else c.data.final_approval!.fingerprint = sha("different approval");
    await expect(bundle()).rejects.toThrow("Exact final human approval");
  },
);
it("rejects a stale selected package version and demo/live crossover", async () => {
  await expect(
    nativeHandoff(rpc, p.id, p.version + 1, true, origin),
  ).rejects.toThrow("Exact package revision");
  await expect(
    nativeHandoff(rpc, p.id, p.version, false, origin),
  ).rejects.toThrow("Exact package revision");
});
it.each(["expiry", "revalidation", "draft", "brand", "rights"])(
  "rechecks %s before export",
  async (change) => {
    if (change === "expiry" || change === "revalidation") {
      c.data.evergreen = false;
      c.data.fresh_until =
        change === "expiry" ? "2000-01-01T00:00:00Z" : "2999-01-01T00:00:00Z";
      c.data.revalidation_required = change === "revalidation";
    } else if (change === "draft")
      stories[0].drafts.find((d) => d.id === c.draft_id)!.revision++;
    else if (change === "brand")
      state.entities.find((e) => e.kind === "brand")!.version++;
    else
      stories[0].assets.find((a) =>
        stories[0].drafts
          .find((d) => d.id === c.draft_id)!
          .asset_ids.includes(a.id),
      )!.rights_status = "blocked";
    await expect(bundle()).rejects.toThrow("Handoff blocked");
  },
);
it("does not accept another content item through a selected package", async () => {
  p.data.content_id = crypto.randomUUID();
  await expect(bundle()).rejects.toThrow("Package/content revision mismatch");
});
it("exports only selected copy and private application downloads, never raw account or media metadata", async () => {
  graphic();
  state.entities.push(
    entity("account", {
      token: "SECRET-TOKEN",
      external_id: "PRIVATE-ACCOUNT",
      email: "private@example.com",
    }),
  );
  Object.assign(p.data, {
    access_token: "SECRET-TOKEN",
    file_id: "SECRET-FILE",
    media_url: "https://private.supabase.co/storage/sign?token=SIGNED-SECRET",
  });
  const result = await bundle(),
    json = JSON.stringify(result);
  for (const secret of [
    "SECRET-TOKEN",
    "PRIVATE-ACCOUNT",
    "private@example.com",
    "SECRET-FILE",
    "SIGNED-SECRET",
    "PRIVATE-NOTE",
  ])
    expect(json).not.toContain(secret);
  expect(result.assets.map((a) => a.order)).toEqual([1, 2]);
  expect(result.assets.map((a) => a.sha256)).toEqual([
    sha("image 0"),
    sha("image 1"),
  ]);
  for (const asset of result.assets) {
    const url = new URL(asset.download);
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe("/api/control/handoff");
    expect(url.searchParams.get("package_version")).toBe(String(p.version));
  }
  expect(fetch).not.toHaveBeenCalled();
});
it("blocks stale PNGs and changed graphic rights", async () => {
  const g = graphic();
  g.data.outputs[0].png.source_svg_sha256 = sha("old SVG");
  await expect(bundle()).rejects.toThrow("Ordered current graphic PNGs");
  g.data.rights = "unknown";
  await expect(bundle()).rejects.toThrow("Graphic revision/rights unresolved");
});
it("renders inert escaped copy and manual instructions in HTML, text, and JSON", async () => {
  p.data.caption =
    '</textarea><img src="https://attacker.example/leak" onerror="alert(1)">';
  p.data.thread = ["First approved post", "Second approved post"];
  const result = await bundle(),
    html = renderNativeHandoff(result, "html");
  expect(html).toContain("&lt;/textarea&gt;&lt;img");
  expect(html).not.toContain('<img src="https://attacker.example');
  expect(html).toContain("Content-Security-Policy");
  expect(html).toContain("navigator.clipboard.writeText");
  expect(html).not.toMatch(/\bfetch\(|XMLHttpRequest|window\.open|\.submit\(/);
  expect(renderNativeHandoff(result, "text")).toContain(
    "Final human action required",
  );
  expect(JSON.parse(renderNativeHandoff(result, "json")).thread).toEqual(
    p.data.thread,
  );
});
it("rechecks approval after reading an asset and rejects a mid-download revocation", async () => {
  graphic();
  vi.mocked(rasterBytes).mockImplementation(async () => {
    c.data.final_approval = null;
    return Buffer.from("image 0");
  });
  await expect(
    nativeHandoffAsset(rpc, p.id, p.version, true, 1),
  ).rejects.toThrow("Exact final human approval");
});
it("verifies downloaded asset bytes against the approved checksum", async () => {
  graphic();
  vi.mocked(rasterBytes).mockResolvedValue(Buffer.from("tampered"));
  await expect(
    nativeHandoffAsset(rpc, p.id, p.version, true, 1),
  ).rejects.toThrow("Asset checksum mismatch");
  vi.mocked(rasterBytes).mockResolvedValue(Buffer.from("image 0"));
  expect(
    (await nativeHandoffAsset(rpc, p.id, p.version, true, 1)).name,
  ).toMatch(/-01\.png$/);
});
it("requires same-origin export requests before loading private state", async () => {
  const response = await POST(request(undefined, "https://other.example"));
  expect(response.status).toBe(403);
  expect(editor).not.toHaveBeenCalled();
  expect(applicationRpc).not.toHaveBeenCalled();
});
it("authenticates both export and asset downloads", async () => {
  vi.mocked(editor).mockRejectedValue(Error("Unauthorized"));
  expect((await POST(request())).status).toBe(401);
  expect(
    (
      await GET(
        new Request(
          origin +
            `/api/control/handoff?package_id=${p.id}&package_version=1&asset=1`,
        ),
      )
    ).status,
  ).toBe(401);
  expect(applicationRpc).not.toHaveBeenCalled();
});
it("returns downloadable private files and never records publication", async () => {
  const response = await POST(
    request({ package_id: p.id, package_version: p.version, format: "html" }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-disposition")).toContain("attachment;");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(await response.text()).toContain("Not submitted");
  expect(fetch).not.toHaveBeenCalled();
  expect(state.entities.filter((e) => e.kind === "publication")).toHaveLength(
    0,
  );
});
it("serves authenticated revision-bound assets without redirects or storage URLs", async () => {
  p.data.subtitles = "1\n00:00:00,000 --> 00:00:01,000\nDEMO\n";
  const result = await bundle(),
    response = await GET(new Request(result.assets[0].download));
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).toBe(p.data.subtitles);
  c.data.final_approval = null;
  expect((await GET(new Request(result.assets[0].download))).status).toBe(422);
  expect(fetch).not.toHaveBeenCalled();
});
it("permits user-clicked downloads from saved HTML but rejects cross-site fetches", async () => {
  p.data.subtitles = "DEMO subtitles";
  const result = await bundle(),
    url = result.assets[0].download;
  expect(
    (
      await GET(
        new Request(url, {
          headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" },
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await GET(
        new Request(url, {
          headers: {
            "sec-fetch-site": "cross-site",
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
            "sec-fetch-user": "?1",
          },
        }),
      )
    ).status,
  ).toBe(200);
});
it.each(["instagram", "tiktok", "youtube"] as const)(
  "requires usable media for %s instead of exporting an unusable upload handoff",
  async (platform) => {
    c.data.platform = platform;
    p.data.platform = platform;
    approve();
    await expect(bundle()).rejects.toThrow(/requires.*(media|video output)/);
  },
);
