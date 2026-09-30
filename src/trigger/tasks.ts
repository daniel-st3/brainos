import { task } from "@trigger.dev/sdk";
// Explicit integration boundaries. No schedules, scraping, or external writes are enabled.
const deferred = (capability: string) => ({
  status: "configuration_required" as const,
  capability,
  message: "Integration boundary only; no data was collected or changed.",
});
export const ingestStories = task({
  id: "ingest-stories",
  run: async () => deferred("Allowlisted RSS/API ingestion"),
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
