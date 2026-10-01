import type { DiscoveryInsights } from "../ingestion/types";
export const statuses = [
  "detected",
  "verified",
  "researched",
  "angle_ready",
  "drafted",
  "assets_cleared",
  "recording_needed",
  "render_ready",
  "review",
  "approved",
  "scheduled",
  "published",
  "measured",
] as const;
export type StoryStatus = (typeof statuses)[number];
export type Level = "high" | "medium" | "low" | "unknown";
export type Platform = "instagram" | "x" | "newsletter" | "short_video";
export interface Source {
  id: string;
  story_id: string;
  url: string;
  canonical_url: string;
  tier: "primary" | "journalism" | "discovery";
  publisher: string;
  author: string;
  published_at: string | null;
  retrieved_at: string;
  type: string;
  title: string;
  excerpt: string;
  is_primary: boolean;
  reliability: string;
}
export interface Claim {
  id: string;
  story_id: string;
  text: string;
  confidence: Level;
  verification_status: "unverified" | "supported" | "conflicting";
  notes: string;
}
export interface Evidence {
  id: string;
  story_id: string;
  claim_id: string;
  source_id: string;
  excerpt: string;
  locator: string;
}
export interface Angle {
  id: string;
  story_id: string;
  text: string;
  rationale: string;
  kind: "fast_news" | "opinion" | "practical";
  created_by: "human" | "ai";
  approval_state: "suggested" | "approved" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  provenance: string;
}
export interface Draft {
  id: string;
  story_id: string;
  platform: Platform;
  format: string;
  language: string;
  hook: string;
  body: string;
  cta: string;
  target_duration: number | null;
  revision: number;
  status:
    "draft" | "approved" | "changes_requested" | "rejected" | "superseded";
  angle_id: string;
  claim_ids: string[];
  asset_ids: string[];
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  provenance: string;
  shot_notes: string;
}
export interface Asset {
  id: string;
  story_id: string;
  draft_id: string | null;
  type: string;
  title: string;
  source_url: string;
  storage_url: string | null;
  publisher: string;
  retrieved_at: string;
  usage_basis: string;
  attribution: string;
  rights_status: "unknown" | "cleared" | "blocked";
  publishable: boolean;
  notes: string;
  cleared_by: string | null;
  cleared_at: string | null;
}
export interface HistoryEvent {
  id: string;
  story_id: string;
  type: string;
  actor: string;
  from_status: StoryStatus | null;
  to_status: StoryStatus | null;
  draft_id: string | null;
  detail: string;
  created_at: string;
}
export interface Publication {
  id: string;
  story_id: string;
  draft_id: string;
  platform: Platform;
  destination: string;
  scheduled_at: string | null;
  status:
    | "ready_to_schedule"
    | "scheduled_internal"
    | "integration_required"
    | "published_manual"
    | "cancelled";
  published_url: string | null;
  created_at: string;
}
export interface Story {
  discovery?: DiscoveryInsights;
  id: string;
  title: string;
  summary: string;
  status: StoryStatus;
  pillar: string;
  story_type: string;
  primary_language: string;
  discovered_at: string;
  published_at: string | null;
  urgency: Level;
  confidence: Level;
  audience_relevance: Level;
  latam_relevance: Level;
  commercial_relevance: Level;
  why_matters: string;
  latam_reason: string;
  research_notes: string;
  research_confirmed: boolean;
  priority: boolean;
  archived: boolean;
  is_demo: boolean;
  active_draft_id: string | null;
  production_completed: boolean;
  production_checklist: string[];
  created_at: string;
  updated_at: string;
  version: number;
  sources: Source[];
  claims: Claim[];
  evidence: Evidence[];
  angles: Angle[];
  drafts: Draft[];
  assets: Asset[];
  events: HistoryEvent[];
  publications: Publication[];
}
export const labels: Record<StoryStatus, string> = {
  detected: "Needs verification",
  verified: "Research ready",
  researched: "Angle needed",
  angle_ready: "Ready to draft",
  drafted: "Drafted",
  assets_cleared: "Assets cleared",
  recording_needed: "Recording needed",
  render_ready: "Render ready",
  review: "Awaiting review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published manually",
  measured: "Measured",
};
export const platformLabels: Record<Platform, string> = {
  instagram: "Instagram",
  x: "X",
  newsletter: "Newsletter",
  short_video: "Short video",
};
