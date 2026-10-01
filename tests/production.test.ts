import { beforeAll, afterAll, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import { createDemoStories } from "../src/domain/seed";
import { applyCommand } from "../src/domain/workflow";
import {
  createPackage,
  attachMedia,
  acceptTranscript,
  roughEdit,
  subtitleAssets,
  teleprompter,
  renderIssues,
  platformPackage,
} from "../src/production/model";
import {
  productionAction,
  savePackage,
  currentPackage,
  finishTranscript,
} from "../src/production/service";
import { graphic } from "../src/production/graphics";
import { workerAuthorized } from "../src/production/worker-auth";
import type { Story } from "../src/domain/types";
import type {
  ProductionPackage,
  MediaJob,
  RecordingMedia,
} from "../src/production/types";
let db: PGlite, rpc: Rpc;
beforeAll(async () => {
  db = await initializeDb();
  rpc = localRpc(db);
});
afterAll(async () => db.close());
async function fixture() {
  const ids = new Map<string, string>();
  const original = createDemoStories().find((s) => s.status === "approved")!;
  const s = JSON.parse(
    JSON.stringify(original).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      (id) => {
        if (!ids.has(id)) ids.set(id, crypto.randomUUID());
        return ids.get(id)!;
      },
    ),
  ) as Story;
  await rpc("save_story", { p_story: s, p_expected_version: -1 });
  return {
    s,
    p: await savePackage(
      rpc,
      createPackage(s, s.active_draft_id!, "Daniel"),
      "Daniel",
    ),
  };
}
function media(p: ProductionPackage): RecordingMedia {
  return {
    id: crypto.randomUUID(),
    story_id: p.story_id,
    draft_id: p.draft_id,
    provider: "local",
    file_id: "demo.mp4",
    filename: "demo.mp4",
    mime: "video/mp4",
    bytes: 10000,
    duration: 10,
    captured_at: null,
    uploaded_at: new Date().toISOString(),
    owned_confirmed: true,
    status: "received",
  };
}
function transcript(m: RecordingMedia) {
  return {
    media_id: m.id,
    media_sha256: "a".repeat(64),
    language: "es" as const,
    provider: "fixture",
    duration: 10,
    silences: [{ start: 3, end: 4 }],
    segments: [
      { start: 1, end: 3, text: "Esta es una prueba de producción." },
      { start: 4, end: 6, text: "Esta es una prueba de producción." },
      { start: 7, end: 9, text: "Eh, revisemos la fuente." },
    ],
  };
}
it("creates immutable recording snapshot only for an approved angle and exact draft", async () => {
  const { s, p } = await fixture();
  expect(p.data.packet.revision).toBe(
    s.drafts.find((d) => d.id === s.active_draft_id)!.revision,
  );
  expect(p.data.packet.draft_id).toBe(s.active_draft_id);
  const bad = structuredClone(s);
  bad.angles.forEach((a) => (a.approval_state = "suggested"));
  expect(() => createPackage(bad, bad.active_draft_id!, "Daniel")).toThrow(
    "approve",
  );
  const altered = structuredClone(p);
  altered.data.packet.script = "changed";
  await expect(savePackage(rpc, altered, "Daniel")).rejects.toThrow(
    "immutable",
  );
});
it("draft edits persistently invalidate the package and preserve audit history", async () => {
  const { s, p } = await fixture();
  const d = s.drafts.find((d) => d.id === s.active_draft_id)!;
  const changed = await applyCommand(
    s,
    {
      type: "edit_draft",
      draftId: d.id,
      hook: d.hook,
      body: d.body + " Cambio.",
      cta: d.cta,
      shotNotes: d.shot_notes,
      assetIds: d.asset_ids,
    },
    "Daniel",
  );
  await rpc("save_story", { p_story: changed, p_expected_version: s.version });
  await expect(currentPackage(rpc, p.id)).rejects.toThrow(
    /revision|review|changed/i,
  );
  const q = await db.query<{ valid: boolean }>(
    "select valid from production_packages where id=$1",
    [p.id],
  );
  expect(q.rows[0].valid).toBe(false);
  const h = await db.query(
    "select * from production_history where package_id=$1",
    [p.id],
  );
  expect(h.rows.length).toBeGreaterThan(1);
});
it("binds media to story and draft and rejects unowned uploads", async () => {
  const { p } = await fixture(),
    m = media(p);
  expect(() => attachMedia(p, { ...m, draft_id: crypto.randomUUID() })).toThrow(
    "exact story",
  );
  expect(() => attachMedia(p, { ...m, owned_confirmed: false })).toThrow(
    "Daniel-owned",
  );
  expect(attachMedia(attachMedia(p, m), m).data.media).toHaveLength(1);
});
it("deduplicates transcription jobs and fences stale worker completion", async () => {
  let { p } = await fixture();
  const m = media(p);
  p = await savePackage(rpc, attachMedia(p, m), "Daniel");
  const args = { action: "transcribe", id: p.id, version: p.version };
  const id = await productionAction(rpc, args, "Daniel");
  expect(await productionAction(rpc, args, "Daniel")).toBe(id);
  const job = (await rpc("claim_production")) as MediaJob;
  expect(job.id).toBe(id);
  await expect(
    finishTranscript(
      rpc,
      { ...job, lease_token: crypto.randomUUID() },
      transcript(m),
    ),
  ).rejects.toThrow("lease");
  const done = await finishTranscript(rpc, job, transcript(m));
  expect(done.data.state).toBe("transcribed");
  expect(done.data.transcript?.reviewed).toBe(false);
  await expect(finishTranscript(rpc, job, transcript(m))).rejects.toThrow(
    "changed",
  );
});
it("creates Spanish subtitle files with stable timestamps and escapes markup", async () => {
  const { p } = await fixture(),
    m = media(p);
  const t = acceptTranscript(attachMedia(p, m), transcript(m)).data.transcript!;
  const result = subtitleAssets(t);
  expect(result.srt).toContain("00:00:01,000 --> 00:00:03,000");
  expect(result.vtt).toMatch(/^WEBVTT/);
  expect(JSON.parse(result.json).language).toBe("es");
  expect(result.srt).toContain("producción");
  expect(() =>
    acceptTranscript(attachMedia(p, m), {
      ...transcript(m),
      segments: [{ start: 3, end: 2, text: "bad" }],
    }),
  ).toThrow("ordered");
});
it("makes deterministic timing-preserving pause/repeat/restart suggestions", async () => {
  const { p } = await fixture(),
    m = media(p);
  const n = acceptTranscript(attachMedia(p, m), transcript(m));
  const a = roughEdit(n);
  expect(a).toEqual(roughEdit(n));
  expect(a.markers.map((m) => m.kind)).toEqual(
    expect.arrayContaining(["pause", "repeat", "restart"]),
  );
  expect(a.keep).toEqual([
    { start: 0, end: 3.15 },
    { start: 3.85, end: 10 },
  ]);
  expect(a.reviewed).toBe(false);
});
it("blocks unresolved required assets even after transcript and plan review", async () => {
  const { p } = await fixture(),
    m = media(p);
  const n = acceptTranscript(attachMedia(p, m), transcript(m));
  n.data.transcript!.reviewed = true;
  n.data.edit_plan = { ...roughEdit(n), reviewed: true };
  const a = n.data.assets.find((a) => a.rights === "unknown")!;
  a.required = true;
  expect(renderIssues(n).join(" ")).toContain("unresolved");
  a.rights = "cleared";
  a.publishable = true;
  a.basis = "Own original";
  a.cleared_by = "Daniel";
  a.reference = "owned.png";
  expect(renderIssues(n)).toEqual([]);
});
it("requires explicit asset clearance and invalidates prior output on package change", async () => {
  let { p } = await fixture();
  const a = p.data.assets.find((a) => a.rights === "unknown")!;
  await expect(
    productionAction(
      rpc,
      {
        action: "asset",
        id: p.id,
        version: p.version,
        asset_id: a.id,
        required: true,
        rights: "cleared",
        basis: "",
        attribution: "",
        reference: "",
        confirmed: false,
      },
      "Daniel",
    ),
  ).rejects.toThrow("Explicit rights");
  p.data.output = {
    provider: "local",
    file_id: "test",
    filename: "test",
    mime: "video/mp4",
    bytes: 10,
    sha256: "a".repeat(64),
    duration: 1,
    production_version: p.version,
    media_id: crypto.randomUUID(),
    options: {
      layout: "vertical",
      normalize: false,
      burn_subtitles: false,
      remove_pauses: false,
    },
  };
  p = await savePackage(rpc, p, "Daniel");
  const n = (await productionAction(
    rpc,
    {
      action: "asset",
      id: p.id,
      version: p.version,
      asset_id: a.id,
      required: false,
      rights: "unknown",
      basis: "",
      attribution: "",
      reference: "",
      confirmed: false,
    },
    "Daniel",
  )) as ProductionPackage;
  expect(n.data.output).toBeNull();
  expect(n.data.approval).toBeNull();
});
it("binds final approval to the exact production version and output hash", async () => {
  let { p } = await fixture();
  const m = media(p);
  p = acceptTranscript(attachMedia(p, m), transcript(m));
  p.data.transcript!.reviewed = true;
  p.data.edit_plan = { ...roughEdit(p), reviewed: true };
  p.data.state = "rendered";
  p.data.output = {
    provider: "local",
    file_id: p.id + "/test.mp4",
    filename: "test.mp4",
    mime: "video/mp4",
    bytes: 10,
    sha256: "a".repeat(64),
    duration: 10,
    production_version: p.version,
    media_id: m.id,
    options: {
      layout: "vertical",
      normalize: false,
      burn_subtitles: false,
      remove_pauses: false,
    },
  };
  p = await savePackage(rpc, p, "Daniel");
  await expect(
    productionAction(
      rpc,
      { action: "approve", id: p.id, version: p.version, confirmed: true },
      "Daniel",
    ),
  ).rejects.toThrow("Review");
  p = (await productionAction(
    rpc,
    { action: "review", id: p.id, version: p.version },
    "Daniel",
  )) as ProductionPackage;
  const approved = (await productionAction(
    rpc,
    { action: "approve", id: p.id, version: p.version, confirmed: true },
    "Daniel",
  )) as ProductionPackage;
  expect(approved.data.approval?.production_version).toBe(approved.version);
  expect(approved.data.approval?.output_sha256).toBe(
    approved.data.output?.sha256,
  );
  await expect(
    productionAction(
      rpc,
      { action: "approve", id: p.id, version: p.version, confirmed: true },
      "Daniel",
    ),
  ).rejects.toThrow("Conflict");
  expect(platformPackage(approved).review_required).toBe(false);
});
it("exports clean escaped teleprompter with exact revision metadata outside the spoken text", async () => {
  const { p } = await fixture();
  p.data.packet.teleprompter = "Hola <script>\n\n**Pausa**";
  expect(teleprompter([p])).toBe(p.data.packet.teleprompter);
  const html = teleprompter([p], true, true);
  expect(html).not.toContain("<script>");
  expect(html).toContain("<strong>Pausa</strong>");
  expect(html).toContain(`data-draft="${p.draft_id}"`);
});
it("requires real retained excerpts for quote/stat cards and never grants rights", async () => {
  const { s } = await fixture(),
    source = s.sources[0];
  const svg = graphic(s, "source", { source_id: source.id });
  expect(svg).toContain(s.id);
  expect(svg).toContain("publishable");
  expect(() =>
    graphic(s, "quote", { source_id: source.id, text: "invented quotation" }),
  ).toThrow("exact retained");
  expect(() =>
    graphic(s, "stat", { source_id: source.id, text: "99% made up" }),
  ).toThrow("exact retained");
});
it("batch accepts only 3–10 distinct valid packages", async () => {
  const pieces = await Promise.all([fixture(), fixture(), fixture()]);
  const ids = pieces.map((x) => x.p.id);
  expect(
    await productionAction(
      rpc,
      { action: "batch", name: "DEMO batch", package_ids: ids },
      "Daniel",
    ),
  ).toBeTypeOf("string");
  await expect(
    productionAction(
      rpc,
      { action: "batch", name: "Bad", package_ids: [ids[0], ids[0], ids[0]] },
      "Daniel",
    ),
  ).rejects.toThrow("distinct");
});
it("denies browser database permissions and fails closed without worker token", async () => {
  const q = await db.query<{ allowed: boolean }>(
    "select has_table_privilege('authenticated','production_packages','UPDATE') or has_function_privilege('anon','claim_production()','EXECUTE') as allowed",
  );
  expect(q.rows[0].allowed).toBe(false);
  expect(workerAuthorized(null)).toBe(false);
  expect(workerAuthorized("wrong")).toBe(false);
  await expect(db.exec("delete from production_history")).rejects.toThrow(
    "append-only",
  );
});

it("renders all four graphic formats with retained source attribution", async () => {
  const { s } = await fixture();
  const first = s.sources[0];
  first.excerpt = "DEMO: 42 pruebas verificadas.";
  const second = {
    ...first,
    id: crypto.randomUUID(),
    publisher: "Segunda fuente DEMO",
    excerpt: "DEMO: 39 pruebas verificadas.",
  };
  s.sources.push(second);
  for (const kind of ["source", "quote", "stat", "comparison"] as const) {
    const svg = graphic(s, kind, {
      source_id: first.id,
      second_source_id: second.id,
      text: first.excerpt,
    });
    expect(svg).toContain(first.id);
    expect(svg).toContain("DERECHOS PENDIENTES");
    expect(svg).toContain('width="1080" height="1350"');
    if (kind === "comparison") expect(svg).toContain(second.id);
  }
});
it("rejects changed source bytes and unordered acoustic timings", async () => {
  const { p } = await fixture(),
    m = { ...media(p), sha256: "b".repeat(64) };
  expect(() => acceptTranscript(attachMedia(p, m), transcript(m))).toThrow(
    "checksum",
  );
  const raw = media(p);
  expect(() =>
    acceptTranscript(attachMedia(p, raw), {
      ...transcript(raw),
      silences: [
        { start: 6, end: 7 },
        { start: 2, end: 3 },
      ],
    }),
  ).toThrow("unordered");
});
