import type { Rpc } from "../ingestion/store";
import { oauthConfiguration } from "./google-oauth";
import { driveToken } from "./media";
import { personalDriveConfiguration } from "./personal-drive";

export type DriveConnectionStatus =
  | { state: "unconfigured" | "disconnected" | "unavailable" }
  | { state: "connected"; email: string; root: string };

/** Server-only check; never pass the database connection or token to the UI. */
export async function driveConnectionStatus(
  rpc: Rpc,
): Promise<DriveConnectionStatus> {
  try {
    oauthConfiguration();
  } catch {
    return { state: "unconfigured" };
  }
  try {
    const connection = await rpc("read_google_connection");
    if (!connection) return { state: "disconnected" };
    // A saved row alone does not prove an unrevoked credential or folder access.
    await driveToken();
    const { email, root } = personalDriveConfiguration();
    return { state: "connected", email, root };
  } catch {
    return { state: "unavailable" };
  }
}
