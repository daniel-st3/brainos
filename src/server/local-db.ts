import { PGlite } from "@electric-sql/pglite";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createDemoStories } from "../domain/seed";
export async function initializeDb(dataDir?: string) {
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.exec(
    "create table if not exists _migrations (name text primary key)",
  );
  // Supabase has these roles already; the embedded database needs equivalent names for migration validation.
  await db.exec(
    "do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; create role authenticated; create role service_role; end if; end $$;",
  );
  for (const file of (
    await readdir(path.join(process.cwd(), "supabase/migrations"))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const result = await db.query(
      "select name from _migrations where name=$1",
      [file],
    );
    if (!result.rows.length)
      await db.transaction(async (tx) => {
        await tx.exec(
          await readFile(
            path.join(process.cwd(), "supabase/migrations", file),
            "utf8",
          ),
        );
        await tx.query("insert into _migrations values($1)", [file]);
      });
  }
  return db;
}
export async function seedDb(db: PGlite) {
  const result = await db.query<{ count: number }>(
    "select count(*)::int as count from stories",
  );
  if (result.rows[0].count === 0)
    for (const story of createDemoStories())
      await db.query("select save_story($1::jsonb,-1)", [
        JSON.stringify(story),
      ]);
}
const globalDb = globalThis as unknown as { newsroomDb?: Promise<PGlite> };
export function localDb() {
  globalDb.newsroomDb ??= (async () => {
    const db = await initializeDb(
      process.env.CONTENT_OS_DATA_DIR ??
        path.join(process.cwd(), ".data/newsroom"),
    );
    await seedDb(db);
    return db;
  })();
  return globalDb.newsroomDb;
}
