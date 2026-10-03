/** Optional experimental Trigger wake path; never imported by production approval routes. */
import { idempotencyKeys, tasks, wait } from "@trigger.dev/sdk";
import type { Rpc } from "../ingestion/store";
import { findReview } from "./service";
export function approvalRuntimeReady() {
  return !!process.env.TRIGGER_SECRET_KEY && !!process.env.TRIGGER_PROJECT_REF;
}
/** Delivery hint only: the database decision remains the authority, never token output. */
export async function wakeApproval(rpc: Rpc, id: string) {
  if (!approvalRuntimeReady())
    return {
      connected: false,
      pending: true,
      reason: "TRIGGER_RUNTIME_NOT_CONFIGURED",
    };
  const r = await findReview(rpc, id);
  if (r.data.wait_token_id && r.data.decision) {
    try {
      await wait.completeToken(r.data.wait_token_id, { candidate_id: id });
    } catch {
      /* An expired token must not prevent replay of a durable decision. */
    }
  }
  try {
    await tasks.trigger(
      "publication-approval",
      { candidateId: id },
      {
        idempotencyKey: await idempotencyKeys.create(
          `approval:${id}:${r.data.decision ? "decided" : "start"}`,
          { scope: "global" },
        ),
        idempotencyKeyTTL: "30d",
      },
    );
    return { connected: true, pending: false };
  } catch {
    // Decision is already durable. The recovery schedule replays wake/resume; never ask for reapproval.
    return { connected: true, pending: true, reason: "CLOUD_RESUME_PENDING" };
  }
}
