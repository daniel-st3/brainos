import { initializeDb, seedDb } from "../src/server/local-db";
const db = await initializeDb();
try {
  await seedDb(db);
  const result = await db.query<{ count: number }>(
    "select count(*)::int as count from stories",
  );
  const security = await db.query<{ tablename: string; rowsecurity: boolean }>(
    "select tablename,rowsecurity from pg_tables where schemaname='public' and tablename<>'_migrations'",
  );
  if (result.rows[0].count !== 7 || security.rows.some((r) => !r.rowsecurity))
    throw new Error("Schema validation failed");
  console.log(
    `Migration applied; ${result.rows[0].count} demo stories; ${security.rows.length} tables with RLS enabled.`,
  );
} finally {
  await db.close();
}
