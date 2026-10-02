import { editor } from "@/server/auth";
import { applicationRpc } from "@/ingestion/store";
import { OpportunityInbox } from "@/components/opportunity-inbox";
export default async function Opportunities() {
  await editor();
  const rows = (await (
    await applicationRpc()
  )("read_opportunities")) as Parameters<typeof OpportunityInbox>[0]["initial"];
  return (
    <main id="main-content" className="page">
      <h1>Opportunity Inbox</h1>
      <OpportunityInbox initial={rows} />
    </main>
  );
}
