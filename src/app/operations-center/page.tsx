import Link from "next/link";
import { StatusChip } from "@/components/design/primitives";
import { driveConnectionStatus } from "@/integrations/drive-status";
import { PageHeader } from "@/components/ui";
import { editor } from "@/server/auth";
import { operationsCenter } from "@/operations/center";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
import { FailureInbox } from "@/components/failure-inbox";
export default async function Operations() {
  await editor();
  const rpc = await applicationRpc();
  const { state, ...center } = await operationsCenter(
    rpc,
    dataMode() === "demo",
  );
  const drive =
    dataMode() === "demo"
      ? { state: "unconfigured" as const }
      : await driveConnectionStatus(rpc);
  const connected = state.entities.filter(
    (e) => e.kind === "account" && e.data.status === "connected",
  ).length;
  return (
    <section className="page">
      <PageHeader
        eyebrow="SYSTEM / OPERATIONS"
        title="Operations / Failure Inbox"
        description="Observed scheduler windows, worker presence and recoverable failures. No estimated uptime."
      />
      <div className="health-rows">
        <div className="health-row">
          <div>
            <h3>
              {dataMode() === "demo" ? "Local fixture database" : "Supabase"}
            </h3>
            <p>Current workspace query succeeded</p>
          </div>
          <StatusChip tone="positive">Reachable</StatusChip>
        </div>
        <div className="health-row">
          <div>
            <h3>Personal Drive</h3>
            <p>
              {drive.state === "connected"
                ? `${drive.email} · Daniel AI Content OS`
                : "Inspect the connection in Production Studio"}
            </p>
          </div>
          <StatusChip
            tone={drive.state === "connected" ? "positive" : "neutral"}
          >
            {drive.state === "connected" ? "Connected" : "Not verified"}
          </StatusChip>
        </div>
        <div className="health-row">
          <div>
            <h3>Provider connections</h3>
            <p>Capabilities and send permissions remain independent.</p>
          </div>
          <Link className="text-link" href="/activation">
            {connected} connected →
          </Link>
        </div>
      </div>
      <FailureInbox center={center} />
    </section>
  );
}
