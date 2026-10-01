import { applicationRpc } from "../src/ingestion/store";
import { closeLocalDb } from "../src/server/local-db";
import { enqueueEditorialWork, runOperations } from "../src/operations/worker";
import type { Story } from "../src/domain/types";
try {
  const rpc = await applicationRpc();
  await enqueueEditorialWork(rpc, (await rpc("read_newsroom")) as Story[]);
  const results = await runOperations(rpc, 100);
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => r.status === "failed")) process.exitCode = 1;
} finally {
  await closeLocalDb();
}
