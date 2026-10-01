import { ingestionStore } from "../src/ingestion/store";
import { runIngestion } from "../src/ingestion/pipeline";
import { dataMode } from "../src/server/mode";
import { closeLocalDb } from "../src/server/local-db";
import { closeFeedConnections } from "../src/ingestion/fetch";
if (dataMode() !== "live")
  throw new Error(
    "Set CONTENT_OS_DATA_MODE=live to ingest. Demo data remains separate.",
  );
const sources = process.argv
  .find((a) => a.startsWith("--sources="))
  ?.slice(10)
  .split(",");
try {
  const runs = await runIngestion(await ingestionStore(), {
    sourceIds: sources,
    force: process.argv.includes("--force"),
  });
  console.log(JSON.stringify(runs, null, 2));
  if (runs.some((r) => r.status === "failed")) process.exitCode = 1;
} finally {
  await closeFeedConnections();
  await closeLocalDb();
}
