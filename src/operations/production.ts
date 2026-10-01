import { approvalIssues } from "../domain/workflow";
import type { Story } from "../domain/types";
export function approvedProductionPacket(story: Story, draftId: string) {
  const d = story.drafts.find((d) => d.id === draftId);
  if (!d || d.status !== "approved" || !d.approved_at || !d.approved_by)
    throw new Error("An explicitly approved exact revision is required.");
  const issues = approvalIssues(story, d);
  if (issues.length) throw new Error(issues.join(" "));
  return {
    story_id: story.id,
    draft_id: d.id,
    revision: d.revision,
    approved_by: d.approved_by,
    approved_at: d.approved_at,
    hook: d.hook,
    target_duration: d.target_duration,
    script: d.body,
    cta: d.cta,
    recording_notes: d.shot_notes,
    teleprompter: [d.hook, d.body, d.cta].filter(Boolean).join("\n\n"),
    shot_list: d.shot_notes.split(/\n/).filter(Boolean),
    assets: d.asset_ids.map((id) => story.assets.find((a) => a.id === id)!),
    checklist: [
      "Exact script revision confirmed",
      "Sound and framing checked",
      "Private screen details hidden",
      "Only cleared assets used",
    ],
    source_urls: story.sources.map((s) => s.canonical_url),
  };
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/** Text-only programmatic working card. Never simulates a product screenshot. */
export function sourceCard(story: Story) {
  const wrap = (s: string, n: number) =>
    s.match(new RegExp(`.{1,${n}}(?:\\s|$)|.{1,${n}}`, "g")) ?? [];
  const lines = wrap(story.title, 46).slice(0, 5);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="#f4f1e9"/><g fill="#17221e" font-family="sans-serif"><text x="72" y="108" font-size="24">CONTENT OS · WORKING SOURCE CARD</text>${lines.map((t, i) => `<text x="72" y="${240 + i * 68}" font-size="46">${escape(t.trim())}</text>`).join("")}<text x="72" y="850" font-size="22">Human review required · no screenshot or outcome implied</text><text x="72" y="910" font-size="18">${escape((story.sources[0]?.canonical_url ?? "Source required").slice(0, 100))}</text></g></svg>`;
}
export interface PostRecordingRequest {
  mediaId: string;
  draftId: string;
  revision: number;
  language: string;
}
export interface PostRecordingProvider {
  transcribe(
    input: PostRecordingRequest,
  ): Promise<{
    segments: { start: number; end: number; text: string }[];
    provider: string;
  }>;
  prepareRoughCut(
    input: PostRecordingRequest,
  ): Promise<{ editDecisionList: unknown; reviewRequired: true }>;
}
export const postRecordingPlan = {
  steps: [
    "owned recording upload",
    "local transcription",
    "timestamped transcript review",
    "proposed silence cuts",
    "subtitle and B-roll markers",
    "vertical layout",
    "human edit review",
    "export",
  ],
  tools: ["ffmpeg", "local Whisper"],
  enabled: false,
  reason:
    "Local media worker not configured; no synthetic face or voice generation.",
};
