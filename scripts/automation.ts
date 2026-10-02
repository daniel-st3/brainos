import { executeAutomation } from "../src/operations/automation";
import { applicationRpc } from "../src/ingestion/store";
import { closeLocalDb } from "../src/server/local-db";
import { closeFeedConnections } from "../src/ingestion/fetch";
try {
  console.log(
    await executeAutomation(
      await applicationRpc(),
      process.argv.includes("--operations") ? "operations" : "discovery",
      "manual",
    ),
  );
} finally {
  await closeFeedConnections();
  await closeLocalDb();
}
