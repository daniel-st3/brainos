/** Isolated local verification only. Never seeds a connected project. */
import { initializeDb } from "../src/server/local-db";
import { createDemoStories } from "../src/domain/seed";
import { applyCommand } from "../src/domain/workflow";
import { localRpc } from "../src/ingestion/store";
import { productionAction } from "../src/production/service";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Story } from "../src/domain/types";
if (process.env.CONTENT_OS_MODE === "supabase")
  throw Error("Demo seed is local only");
const dir = process.env.CONTENT_OS_DATA_DIR;
if (!dir?.endsWith("production-flow"))
  throw Error("Use an isolated production-flow directory");
const db = await initializeDb(dir),
  rpc = localRpc(db);
try {
  const prior = await db.query("select id from stories");
  if (prior.rows.length) throw Error("Verification database must be empty");
  const pieces = [];
  for (let i = 0; i < 3; i++) {
    const ids = new Map<string, string>();
    const s = JSON.parse(
      JSON.stringify(
        createDemoStories().find((s) => s.status === "approved")!,
      ).replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
        (id) => {
          if (!ids.has(id)) ids.set(id, crypto.randomUUID());
          return ids.get(id)!;
        },
      ),
    ) as Story;
    const d = s.drafts.find((d) => d.id === s.active_draft_id)!;
    s.drafts = [d];
    s.events = [];
    s.publications = [];
    s.assets = [];
    s.angles = s.angles.filter((a) => a.id === d.angle_id);
    s.sources = s.sources.slice(0, 1);
    s.claims = s.claims.slice(0, 1);
    s.evidence = s.evidence.slice(0, 1);
    const quote =
      "And so, my fellow Americans: ask not what your country can do for you, ask what you can do for your country.";
    s.title = `[DEMO] Local production verification ${i + 1}`;
    s.summary =
      "Isolated software test; archival speech fixture, not Daniel speaking.";
    s.status = "review";
    s.is_demo = true;
    s.version = 0;
    s.research_confirmed = true;
    s.sources[0].url = s.sources[0].canonical_url =
      "https://github.com/ggml-org/whisper.cpp/blob/master/samples/jfk.wav";
    s.sources[0].publisher = "JFK inaugural speech / whisper.cpp test sample";
    s.sources[0].excerpt = quote;
    s.sources[0].title = "Archival real speech test fixture";
    s.claims[0].text =
      "Demo fixture contains an attributed excerpt of archival speech.";
    s.claims[0].verification_status = "supported";
    s.evidence[0].claim_id = s.claims[0].id;
    s.evidence[0].source_id = s.sources[0].id;
    s.evidence[0].excerpt = quote;
    d.hook = "And so, my fellow Americans.";
    d.body =
      "Ask not what your country can do for you. Ask what you can do for your country.";
    d.cta = "";
    d.language = "en";
    d.platform = "short_video";
    d.asset_ids = [];
    d.claim_ids = [s.claims[0].id];
    d.status = "draft";
    d.approved_at = null;
    d.approved_by = null;
    d.revision = 1;
    d.target_duration = 12;
    d.shot_notes =
      "DEMO: solid background with visible fixture label; no synthetic voice.";
    s.angles[0].approval_state = "suggested";
    s.angles[0].approved_at = null;
    s.angles[0].approved_by = null;
    await rpc("save_story", { p_story: s, p_expected_version: -1 });
    const angle = await applyCommand(
      s,
      { type: "approve_angle", angleId: d.angle_id },
      "DEMO verification actor",
    );
    await rpc("save_story", { p_story: angle, p_expected_version: s.version });
    const approved = await applyCommand(
      angle,
      { type: "approve", draftId: d.id, confirmed: true },
      "DEMO verification actor",
    );
    await rpc("save_story", {
      p_story: approved,
      p_expected_version: angle.version,
    });
    pieces.push(
      await productionAction(
        rpc,
        { action: "create", draft_id: d.id },
        "DEMO verification actor",
      ),
    );
  }
  await mkdir(".data/production-verification", { recursive: true });
  await writeFile(
    path.resolve(".data/production-verification/packages.json"),
    JSON.stringify(pieces, null, 2),
  );
  console.log(
    "Created three clearly labelled demo pieces through angle and script approval. Local database only.",
  );
} finally {
  await db.close();
}
