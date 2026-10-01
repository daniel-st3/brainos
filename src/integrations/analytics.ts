export type AnalyticsProvider =
  "x" | "instagram" | "tiktok" | "youtube" | "newsletter";
export const snapshotWindows = [24, 72, 168] as const;
export interface AnalyticsAdapter {
  provider: AnalyticsProvider;
  collect(
    postId: string,
  ): Promise<{ measuredAt: string; rawMetrics: Record<string, unknown> }>;
}
/** Credentials are provider-specific. No browser automation or invented metrics. */
export const analyticsAdapters: Partial<
  Record<AnalyticsProvider, AnalyticsAdapter>
> = {};
export function snapshotDue(
  publishedAt: string,
  hours: (typeof snapshotWindows)[number],
) {
  const time = Date.parse(publishedAt);
  if (!Number.isFinite(time))
    throw new Error("Actual publication timestamp required");
  return new Date(time + hours * 3600000).toISOString();
}
