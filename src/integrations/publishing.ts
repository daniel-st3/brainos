import { approvedProductionPacket } from "../operations/production";
import type { Story } from "../domain/types";
export type PublisherName = "x" | "instagram" | "youtube" | "newsletter";
export interface PublishingAdapter {
  name: PublisherName;
  publish(input: {
    idempotencyKey: string;
    destination: string;
    packet: ReturnType<typeof approvedProductionPacket>;
  }): Promise<{ providerId: string; url: string; raw: unknown }>;
}
/** Handoff only. This application deliberately has no route that sends a publication. */
export function publishingHandoff(story: Story, publicationId: string) {
  const pub = story.publications.find((p) => p.id === publicationId);
  if (
    !pub ||
    pub.status !== "scheduled_internal" ||
    story.status !== "scheduled" ||
    !story.production_completed
  )
    throw new Error(
      "An approved, produced and internally scheduled publication is required.",
    );
  const packet = approvedProductionPacket(story, pub.draft_id);
  return {
    idempotencyKey: pub.id,
    platform: pub.platform,
    destination: pub.destination,
    scheduledAt: pub.scheduled_at,
    packet,
    integration_status: "integration_required",
    sent: false,
  };
}
export function newsletterIssue(
  title: string,
  sections: { story: Story; draftId: string }[],
) {
  if (!title.trim() || !sections.length)
    throw new Error("Issue title and sections required");
  return {
    title,
    status: "review" as const,
    sections: sections.map(({ story, draftId }, position) => {
      const packet = approvedProductionPacket(story, draftId);
      if (story.drafts.find((d) => d.id === draftId)?.platform !== "newsletter")
        throw new Error("Newsletter revision required");
      return { position, ...packet };
    }),
    publishing_status: "integration_required",
  };
}
