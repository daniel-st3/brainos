import { z } from "zod";
export const decisionInput = z
  .object({
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(["approve", "request_changes", "reject"]),
    feedback: z.string().max(4000).default(""),
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
  };
  wait_token_id: string | null;
  outbox_id: string | null;
}
