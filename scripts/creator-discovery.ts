import { applicationRpc } from "../src/ingestion/store";
import { runCreatorDiscovery } from "../src/creator/discovery";
import { closeFeedConnections } from "../src/ingestion/fetch";
try {
  console.log(
    JSON.stringify(await runCreatorDiscovery(await applicationRpc())),
  );
} finally {
  await closeFeedConnections();
}
