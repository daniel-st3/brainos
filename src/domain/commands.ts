import { z } from "zod";
import { statuses } from "./types";
const text = z.string().trim().min(1).max(12000);
const id = z.string().uuid();
const safeUrl = z
  .string()
  .url()
  .refine(
    (s) => ["http:", "https:"].includes(new URL(s).protocol),
    "Use an HTTP or HTTPS URL",
  );
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("transition"), target: z.enum(statuses) }),
  z.object({ type: z.literal("prioritize") }),
  z.object({ type: z.literal("queue_research") }),
  z.object({ type: z.literal("archive") }),
  z.object({
    type: z.literal("research"),
    notes: text,
    confirmed: z.boolean(),
  }),
  z.object({
    type: z.literal("verify_claim"),
    claimId: id,
    verification: z.enum(["supported", "unverified", "conflicting"]),
    notes: text,
  }),
  z.object({ type: z.literal("suggest_angles") }),
  z.object({ type: z.literal("add_angle"), text, rationale: text }),
  z.object({ type: z.literal("approve_angle"), angleId: id }),
  z.object({
    type: z.literal("generate_draft"),
    angleId: id,
    platform: z.enum(["instagram", "x", "newsletter", "short_video"]),
  }),
  z.object({
    type: z.literal("edit_draft"),
    draftId: id,
    hook: text,
    body: text,
    cta: z.string().trim().max(2000),
    shotNotes: z.string().trim().max(5000),
    assetIds: z.array(id).max(30),
  }),
  z.object({ type: z.literal("select_draft"), draftId: id }),
  z.object({
    type: z.literal("approve"),
    draftId: id,
    confirmed: z.literal(true),
  }),
  z.object({ type: z.literal("request_changes"), draftId: id, reason: text }),
  z.object({ type: z.literal("reject"), draftId: id, reason: text }),
  z.object({ type: z.literal("return_research"), reason: text }),
  z.object({
    type: z.literal("asset_rights"),
    assetId: id,
    rights: z.enum(["unknown", "cleared", "blocked"]),
    basis: text,
    attribution: z.string().trim().max(2000),
  }),
  z.object({
    type: z.literal("add_asset"),
    title: text,
    sourceUrl: safeUrl,
    publisher: text,
    assetType: text,
  }),
  z.object({
    type: z.literal("production"),
    checklist: z.array(z.enum(["script", "sound", "visuals"])).max(3),
  }),
  z.object({
    type: z.literal("schedule"),
    draftId: id,
    destination: text,
    scheduledAt: z.string().datetime({ offset: true }),
  }),
  z.object({
    type: z.literal("mark_published"),
    publicationId: id,
    url: safeUrl,
  }),
]);
export type Command = z.infer<typeof commandSchema>;
export const requestSchema = z.object({
  storyId: id,
  expectedVersion: z.number().int().nonnegative(),
  command: commandSchema,
});
