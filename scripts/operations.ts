import { processJobs } from "../src/control/service";
import { dataMode } from "../src/server/mode";
import { applicationRpc } from "../src/ingestion/store";
import { closeLocalDb } from "../src/server/local-db";
import { enqueueEditorialWork, runOperations } from "../src/operations/worker";
import type { Story } from "../src/domain/types";
try {
  const rpc = await applicationRpc();
  await enqueueEditorialWork(rpc, (await rpc("read_newsroom")) as Story[]);
  const results = await runOperations(rpc, 100);
  console.log(JSON.stringify(results, null, 2));
  for (const kind of ["graphic", "distribution", "analytics"] as const) {
    const result = await processJobs(rpc, kind, dataMode() === "demo");
    console.log(`${kind}: ${result.processed.length} control jobs processed`);
  }
  if (results.some((r) => r.status === "failed")) process.exitCode = 1;
} finally {
  await closeLocalDb();
}
