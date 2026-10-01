import type { approvedProductionPacket } from "../operations/production";
export type ProductionState =
  | "recording_needed"
  | "recording_received"
  | "transcribed"
  | "edit_plan_ready"
  | "assets_ready"
  | "render_ready"
  | "rendered"
  | "review"
  | "approved";
export interface Segment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
}
export interface Transcript {
  language: "es" | "en";
  provider: string;
  media_id: string;
  segments: Segment[];
  text: string;
  duration: number;
  silences?: { start: number; end: number }[];
  reviewed: boolean;
}
export interface RecordingMedia {
  id: string;
  story_id: string;
  draft_id: string;
  provider: "supabase" | "drive" | "local";
  file_id: string;
  filename: string;
  mime: string;
  bytes: number;
  duration: number | null;
  captured_at: string | null;
  uploaded_at: string;
  owned_confirmed: boolean;
  sha256?: string;
  status: "received" | "transcribed";
}
export interface ProductionAsset {
  id: string;
  kind:
    "recording" | "screenshot" | "official" | "chart" | "source_card" | "broll";
  title: string;
  required: boolean;
  rights: "unknown" | "cleared" | "blocked";
  publishable: boolean;
  basis: string;
  attribution: string;
  source_url: string;
  reference: string;
  cleared_by?: string;
}
export interface EditMarker {
  start: number;
  end: number;
  kind: "pause" | "repeat" | "restart" | "broll" | "screenshot" | "emphasis";
  reason: string;
  suggested: boolean;
}
export interface EditPlan {
  script_coverage: number;
  script_review: string;
  media_id: string;
  markers: EditMarker[];
  keep: { start: number; end: number }[];
  reviewed: boolean;
  source_timing: true;
  algorithm: "deterministic/v1";
}
export interface RenderOptions {
  layout: "vertical" | "original";
  normalize: boolean;
  burn_subtitles: boolean;
  remove_pauses: boolean;
}
export interface RenderOutput {
  subtitles?: { srt: string; vtt: string; json: string };
  provider: "supabase" | "local";
  file_id: string;
  filename: string;
  mime: "video/mp4";
  bytes: number;
  sha256: string;
  duration: number;
  production_version: number;
  media_id: string;
  options: RenderOptions;
}
export interface ProductionData {
  state: ProductionState;
  packet: ReturnType<typeof approvedProductionPacket>;
  title: string;
  angle_id: string;
  created_by: string;
  created_at: string;
  media: RecordingMedia[];
  selected_media_id: string | null;
  assets: ProductionAsset[];
  transcript: Transcript | null;
  edit_plan: EditPlan | null;
  output: RenderOutput | null;
  approval: {
    actor: string;
    at: string;
    production_version: number;
    output_sha256: string;
  } | null;
}
export interface ProductionPackage {
  id: string;
  story_id: string;
  draft_id: string;
  version: number;
  valid: boolean;
  invalid_reason: string | null;
  data: ProductionData;
}
export interface MediaJob {
  id: string;
  package_id: string;
  package_version: number;
  kind: "transcribe" | "render";
  status: string;
  input: { media_id: string; options?: RenderOptions };
  lease_token: string;
  attempts: number;
  error?: string;
}
export interface ProductionBatch {
  id: string;
  name: string;
  package_ids: string[];
  created_at: string;
}
export interface StudioState {
  packages: ProductionPackage[];
  jobs: Omit<MediaJob, "lease_token">[];
  batches: ProductionBatch[];
}
