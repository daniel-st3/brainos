import { editor } from "@/server/auth";
import { AccountActivation } from "@/components/account-activation";
import { activationState } from "@/providers/activation";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
export default async function Activation() {
  await editor();
  return (
    <AccountActivation
      initial={await activationState(
        await applicationRpc(),
        dataMode() === "demo",
      )}
    />
  );
}
