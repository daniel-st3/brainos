import { task, schedules } from "@trigger.dev/sdk";
import { ingestionStore } from "../ingestion/store";
import { runIngestion } from "../ingestion/pipeline";
// Hosted workers must share the same durable database as the newsroom.
async function ingest(sourceIds?: string[]) {
  if (
    process.env.CONTENT_OS_MODE !== "supabase" ||
    process.env.CONTENT_OS_DATA_MODE !== "live"
  )
    throw new Error(
      "Hosted ingestion requires Supabase and CONTENT_OS_DATA_MODE=live.",
    );
  return runIngestion(await ingestionStore(), { sourceIds });
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
  run: async (payload: { storyId: string }) => ({
    ...deferred("Evidence retrieval and research"),
    storyId: payload.storyId,
  }),
});
export const monitorCompetitors = task({
  id: "monitor-competitors",
  run: async () => deferred("Competitor monitoring — disabled"),
});
export const analyticsSnapshot = task({
  id: "analytics-snapshot",
  run: async () => deferred("Analytics snapshots — disabled"),
});
