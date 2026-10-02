import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { applicationRpc } from "../src/ingestion/store";
import { controlSnapshot } from "../src/control/service";
import { projectExport } from "../src/control/export";
import { dataMode } from "../src/server/mode";
import { closeLocalDb } from "../src/server/local-db";
import { initializeDb } from "../src/server/local-db";
import type { Entity, ControlState } from "../src/control/model";
import type { Story } from "../src/domain/types";
const [action = "backup", location, destination] = process.argv.slice(2);
if (action === "backup") {
  const folder = path.resolve(
    location ??
      `.data/backups/${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const { state, stories, production } = await controlSnapshot(
    await applicationRpc(),
    dataMode() === "demo",
  );
  const file = path.join(folder, "brainos.json");
  await writeFile(
    file,
    JSON.stringify(projectExport(state, stories, production), null, 2),
    { mode: 0o600 },
  );
  console.log(`Private portable snapshot saved: ${file}`);
  await closeLocalDb();
} else if (action === "restore-local") {
  if (!location || !destination)
    throw Error("restore-local requires snapshot and a new local destination");
  const snapshot = JSON.parse(await readFile(location, "utf8")) as {
    schema_version: number;
    stories: Story[];
    control: ControlState;
    production: { packages: unknown[]; jobs: unknown[]; batches: unknown[] };
  };
  if (snapshot.schema_version !== 1)
    throw Error("Unsupported snapshot version");
  const db = await initializeDb(path.resolve(destination));
  try {
    const r = await db.query<{ count: number }>(
      "select count(*)::int as count from stories",
    );
    if (r.rows[0].count)
      throw Error(
        "Restore requires an empty destination; existing data will not be overwritten",
      );
    await db.transaction(async (tx) => {
      for (const story of snapshot.stories)
        await tx.query("select save_story($1::jsonb,-1)", [
          JSON.stringify(story),
        ]);
      for (const e of snapshot.control.entities.filter(
        (e) => e.kind !== "quality",
      ))
        await tx.query(
          "insert into control_entities(id,kind,version,story_id,draft_id,parent_id,is_demo,data) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
          [
            e.id,
            e.kind,
            e.version,
            e.story_id,
            e.draft_id,
            e.parent_id,
            e.is_demo,
            JSON.stringify(e.data),
          ],
        );
      for (const p of snapshot.production.packages)
        await tx.query(
          "insert into production_packages(id,story_id,draft_id,version,valid,invalid_reason,data) select id,story_id,draft_id,version,valid,invalid_reason,data from jsonb_populate_record(null::production_packages,$1::jsonb)",
          [JSON.stringify(p)],
        );
      for (const e of snapshot.control.entities.filter(
        (e: Entity) => e.kind === "quality",
      ))
        await tx.query(
          "update control_entities set data=$2::jsonb where id=$1",
          [e.id, JSON.stringify(e.data)],
        );
      await tx.query("update control_epoch set version=$1", [
        snapshot.control.epoch,
      ]);
    });
    console.log(
      "Metadata restored into isolated local database. Secrets, subscribers, jobs and public visibility are intentionally not restored; review approvals before activation.",
    );
  } finally {
    await db.close();
  }
} else throw Error("Use backup or restore-local");
