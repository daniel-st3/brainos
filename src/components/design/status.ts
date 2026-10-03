/** Presentation only: provider limits never rewrite authentication or permissions. */
const labels: Record<string, string> = {
  AUTH_REQUIRED: "Connect account",
  READY_FOR_AUTH: "Ready to connect",
  IMPLEMENTED_UNVERIFIED: "Setup required",
  CONNECTED: "Connected",
  CREATED: "Account created",
  NOT_CREATED: "Account needed",
  DEGRADED: "Connection needs attention",
  BLOCKED_ACCOUNT_RECOVERY: "Account recovery required",
  YOUTUBE_PROJECT_AUDIT_PRIVATE_ONLY: "Public uploads require Google audit",
  BEEHIIV_POSTS_PLAN_ACCESS_REQUIRED: "Sending unavailable on current plan",
  BLOCKED_BY_WORKER: "Worker unavailable",
  BUFFER_NOT_CONNECTED: "Connect Buffer",
  BUFFER_CHANNEL_MISSING: "Select a Buffer channel",
  BUFFER_CAPABILITY_UNAVAILABLE: "Channel capability unavailable",
  DIRECT_PROVIDER_REQUIRES_APP_REVIEW: "Provider app review required",
  DIRECT_PROVIDER_PAID_ACCESS_REQUIRED: "Provider requires paid access",
  MISSING_HUMAN_ASSET: "Creator asset needed",
  UNKNOWN: "Not verified",
  MATCH: "Matches account",
  DRIFT: "Profile differs from account",
  RECORDING_NEEDED: "Recording needed",
  RECORDING_RECEIVED: "Recording received",
  TRANSCRIBED: "Transcribed",
  EDIT_PLAN_READY: "Edit plan ready",
  ASSETS_READY: "Assets ready",
  RENDER_READY: "Ready to render",
  RENDERED: "Rendered",
  REVIEW: "Human review",
  APPROVED: "Approved",
  DRAFT: "Draft",
};
export function humanStatus(value: unknown) {
  const text = String(value ?? "Not verified");
  return (
    labels[text.toUpperCase()] ??
    text
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/^./, (c) => c.toUpperCase())
  );
}
export function connectionPresentation(status: unknown, blocker: unknown) {
  if (blocker === "BLOCKED_ACCOUNT_RECOVERY")
    return { label: humanStatus(blocker), tone: "warning" as const };
  if (status === "connected")
    return { label: "Connected", tone: "positive" as const };
  return {
    label: humanStatus(status ?? "NOT_CREATED"),
    tone: status === "degraded" ? ("negative" as const) : ("neutral" as const),
  };
}
export function capabilityLabel(
  capability: string,
  platform: string,
  blocker: unknown,
) {
  if (
    platform === "youtube" &&
    capability === "media_upload" &&
    String(blocker).includes("YOUTUBE_PROJECT_AUDIT_PRIVATE_ONLY")
  )
    return "Private upload";
  return (
    (
      {
        profile_read: "Profile read",
        media_upload: "Media upload",
        analytics: "Analytics",
        subscriber_read: "Subscriber read",
        posts_read: "Post read",
        publish: "Publishing",
        schedule: "Scheduling",
      } as Record<string, string>
    )[capability] ?? humanStatus(capability)
  );
}
