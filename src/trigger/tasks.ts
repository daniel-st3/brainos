import { task, schedules } from "@trigger.dev/sdk";
import { ingestionStore } from "../ingestion/store";
import { runIngestion } from "../ingestion/pipeline";
import { enqueueEditorialWork, runOperations } from "../operations/worker";
import type { Story } from "../domain/types";
// Hosted workers must share the same durable database as the newsroom.
async function ingest(sourceIds?: string[]) {
  if (
    process.env.CONTENT_OS_MODE !== "supabase" ||
    process.env.CONTENT_OS_DATA_MODE !== "live"
  )
    throw new Error(
      "Hosted ingestion requires Supabase and CONTENT_OS_DATA_MODE=live.",
    );
  const store = await ingestionStore();
  const runs = await runIngestion(store, { sourceIds });
  await enqueueEditorialWork(
    store.rpc,
    (await store.rpc("read_newsroom")) as Story[],
  );
  const operations = await runOperations(store.rpc, 100);
  if (
    operations.some((o) => o.status === "failed") ||
    runs.some((r) => r.status === "failed" || r.status === "partial")
  )
    throw new Error(
      "Some ingestion sources failed; inspect persisted ingestion runs.",
    );
  return { runs, operations };
}
const deferred = (capability: string) => ({
  status: "configuration_required" as const,
  capability,
  message: "Integration boundary only; no data was collected or changed.",
});
export const ingestStories = task({
  id: "ingest-stories",
  retry: { maxAttempts: 2, minTimeoutInMs: 10000, maxTimeoutInMs: 30000 },
  run: async (payload: { sourceIds?: string[] }) => ingest(payload.sourceIds),
});
// Activated only after deployment to a configured Trigger project. Per-source
// transport retries and failure isolation live in the shared pipeline.
export const morningDiscovery = schedules.task({
  id: "morning-discovery",
  cron: {
    pattern: "30 6 * * *",
    timezone: "America/Bogota",
    environments: ["PRODUCTION"],
  },
  retry: { maxAttempts: 2, minTimeoutInMs: 10000, maxTimeoutInMs: 30000 },
  run: async () => ingest(),
});
export const enrichStory = task({
  id: "enrich-story",
  run: async () => {
    if (process.env.CONTENT_OS_MODE !== "supabase")
      throw new Error("Hosted operations require Supabase.");
    const store = await ingestionStore();
    await enqueueEditorialWork(
      store.rpc,
      (await store.rpc("read_newsroom")) as Story[],
    );
    return runOperations(store.rpc, 100);
  },
});
export const monitorCompetitors = task({
  id: "monitor-competitors",
  run: async () => deferred("Competitor monitoring — disabled"),
});
export const analyticsSnapshot = task({
  id: "analytics-snapshot",
  run: async () => {
    if (process.env.CONTENT_OS_MODE !== "supabase")
      throw new Error("Hosted operations require Supabase.");
    const store = await ingestionStore();
    await enqueueEditorialWork(
      store.rpc,
      (await store.rpc("read_newsroom")) as Story[],
    );
    return runOperations(store.rpc, 100);
  },
});
