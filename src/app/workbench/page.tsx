import { Suspense } from "react";
import { editor } from "@/server/auth";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
import { controlSnapshot, accounts, launchReadiness } from "@/control/service";
import { Workbench } from "@/components/control-workbench";
export const dynamic = "force-dynamic";
export default async function Page() {
  await editor();
  const { state, stories, production } = await controlSnapshot(
    await applicationRpc(),
    dataMode() === "demo",
  );
  return (
    <Suspense fallback={<p>Loading content controls…</p>}>
      <Workbench
        state={state}
        stories={stories}
        production={production}
        accounts={accounts(state)}
        campaigns={state.entities
          .filter((e) => e.kind === "campaign")
          .map((e) => ({
            id: e.id,
            slots: launchReadiness(e, state, stories, production),
          }))}
      />
    </Suspense>
  );
}
