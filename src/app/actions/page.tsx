import { editor } from "@/server/auth";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
import { actions, controlSnapshot } from "@/control/service";
import { ActionQueue } from "@/components/action-queue";
export const dynamic = "force-dynamic";
export default async function Page() {
  await editor();
  const { state, stories, production } = await controlSnapshot(
    await applicationRpc(),
    dataMode() === "demo",
  );
  return (
    <>
      <span className="eyebrow">YOUR DECISIONS / HUMAN CONTROL</span>
      <ActionQueue items={actions(state, stories, production)} />
    </>
  );
}
