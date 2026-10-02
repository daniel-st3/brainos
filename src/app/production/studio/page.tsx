import { driveConnectionStatus } from "@/integrations/drive-status";
import { editor } from "@/server/auth";
import { readStories } from "@/server/repository";
import { applicationRpc } from "@/ingestion/store";
import { studio } from "@/production/service";
import { ProductionStudio } from "@/components/production-studio";
import { PageHeader } from "@/components/ui";
export const dynamic = "force-dynamic";
export default async function Studio() {
  await editor();
  const rpc = await applicationRpc();
  const [state, stories, driveStatus] = await Promise.all([
    studio(rpc),
    readStories(),
    driveConnectionStatus(rpc),
  ]);
  const allowed = new Set(stories.map((s) => s.id));
  state.packages = state.packages.filter((p) => allowed.has(p.story_id));
  return (
    <>
      <PageHeader
        eyebrow="PRODUCTION / STUDIO"
        title="De guion a grabación."
        description="Revisiones exactas, material propio y decisiones humanas. El procesamiento pesado ocurre en tu Mac."
      />
      <ProductionStudio
        initial={state}
        stories={stories}
        driveStatus={driveStatus}
      />
    </>
  );
}
