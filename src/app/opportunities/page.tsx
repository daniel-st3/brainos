import { PageHeader } from "@/components/ui";
import { editor } from "@/server/auth";
import { applicationRpc } from "@/ingestion/store";
import { OpportunityInbox } from "@/components/opportunity-inbox";
export default async function Opportunities() {
  await editor();
  const rows = (await (
    await applicationRpc()
  )("read_opportunities")) as Parameters<typeof OpportunityInbox>[0]["initial"];
  return (
    <section className="page">
      <PageHeader
        eyebrow="WORKSPACE / OPPORTUNITIES"
        title="Opportunity Inbox"
        description="Consulting, speaking and collaboration requests. Daniel decides what moves forward."
      />
      <OpportunityInbox initial={rows} />
    </section>
  );
}
