import { editor } from "@/server/auth";
import { operationsCenter } from "@/operations/center";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
import { FailureInbox } from "@/components/failure-inbox";
export default async function Operations() {
  await editor();
  const { state, ...center } = await operationsCenter(
    await applicationRpc(),
    dataMode() === "demo",
  );
  void state;
  return (
    <main id="main-content" className="page">
      <h1>Operations / Failure Inbox</h1>
      <FailureInbox center={center} />
    </main>
  );
}
