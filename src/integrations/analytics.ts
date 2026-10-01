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
/** Video is a format, not a provider. Infer only from the recorded public URL. */
export function analyticsProviderFor(
  platform: string,
  publishedUrl: string,
): AnalyticsProvider | null {
  if (platform === "newsletter") return "newsletter";
  let host: string;
  try {
    host = new URL(publishedUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const matches = (domain: string) =>
    host === domain || host.endsWith(`.${domain}`);
  if (matches("youtube.com") || host === "youtu.be") return "youtube";
  if (matches("tiktok.com")) return "tiktok";
  if (matches("instagram.com")) return "instagram";
  if (matches("x.com") || matches("twitter.com")) return "x";
  return null;
}
