import { z } from "zod";
import type { ImportedPackage } from "./imported";
export const decisionInput = z
  .object({
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(["approve", "request_changes", "reject"]),
    feedback: z.string().max(4000).default(""),
    neo_risk_acknowledgment: z.string().max(100).optional(),
  })
  .strict();
export type DecisionInput = z.infer<typeof decisionInput>;
export interface ReviewMedia {
  file_id: string;
  sha256: string;
  mime: string;
  bytes: number;
  graphic_id?: string;
  graphic_version?: number;
  source_sha256?: string;
}
export interface Candidate {
  type: "cloud_approval_v1";
  checksum: string;
  frozen: {
    package_id: string;
    package_version: number;
    content_id: string;
    content_version: number;
    story_id: string;
    draft_id: string;
    draft_revision: number;
    title: string;
    caption: string;
    thread: string[];
    platform: string;
    account_id: string;
    account_external_id: string;
    handle: string;
    adapter: string;
    due_at: string | null;
    sources: string[];
    media: ReviewMedia[];
    binding: string;
    simulated: boolean;
    imported?: ImportedPackage;
  };
  state:
    | "AWAITING_DANIEL"
    | "APPROVED"
    | "REQUEST_CHANGES"
    | "REJECTED"
    | "STALE"
    | "EXPIRED"
    | "QUEUED";
  created_at: string;
  expires_at: string | null;
  decision: null | {
    decision: DecisionInput["decision"];
    actor: string;
    at: string;
    feedback: string;
    neo_risk_acknowledgment?: string;
    risk_acknowledgment?: {
      policy_id: string;
      candidate_id: string;
      candidate_checksum: string;
      owner_id: string;
      at: string;
      rights_status: "UNCLEAR";
      caption_sha256: string;
      ordered_media_sha256: string[];
      disclosure: string;
      statement: string;
    };
  };
  wait_token_id: string | null;
  outbox_id: string | null;
}
