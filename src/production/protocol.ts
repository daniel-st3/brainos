import { z } from "zod";
export const WORKER_PROTOCOL = 1;
/** v1 adds presence to the unchanged media payload. Legacy v1 workers remain compatible. */
export function workerIdentity(raw: Record<string, unknown>) {
  if (raw.protocol !== undefined && raw.protocol !== WORKER_PROTOCOL)
    throw Error(
      "Worker protocol mismatch; update the local service before processing",
    );
  return {
    id: z
      .string()
      .min(1)
      .max(100)
      .parse(raw.worker_id ?? "legacy-mac-worker"),
    version: z
      .string()
      .min(1)
      .max(100)
      .parse(raw.worker_version ?? "legacy/v1"),
    capabilities:
      raw.protocol === WORKER_PROTOCOL
        ? ["transcribe", "render", "subtitles", "edit_plan"]
        : ["legacy_media"],
  };
}
