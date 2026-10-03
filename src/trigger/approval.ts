/** Optional experimental Trigger adapter. Production approval uses Supabase + hosted cron. */
import { task, schedules, wait } from "@trigger.dev/sdk";
import { applicationRpc } from "../ingestion/store";
import { readControl } from "../control/service";
import {
  createCandidate,
  findReview,
  attachWaitToken,
  resumeCandidate,
  isReview,
  expireCandidate,
} from "../approval/service";
import { processOutbox } from "../providers/outbox";
import { wakeApproval } from "../approval/runtime";
function cloudOnly() {
  if (process.env.CONTENT_OS_MODE !== "supabase")
    throw Error("HOSTED_SUPABASE_REQUIRED");
}
export const preparePublicationReview = task({
  id: "prepare-publication-review",
  retry: { maxAttempts: 3 },
  run: async (payload: {
    packageId: string;
    scheduledAt?: string;
    staging?: boolean;
  }) => {
    cloudOnly();
    const rpc = await applicationRpc();
    const review = await createCandidate(
      rpc,
      payload.packageId,
      payload.scheduledAt ?? null,
      payload.staging === true,
    );
    const wake = await wakeApproval(rpc, review.id);
    if (wake.pending) throw Error(wake.reason);
    return { candidateId: review.id, state: review.data.state };
  },
});
export const publicationApproval = task({
  id: "publication-approval",
  retry: { maxAttempts: 4 },
  run: async ({ candidateId }: { candidateId: string }) => {
    cloudOnly();
    const rpc = await applicationRpc();
    let row = await findReview(rpc, candidateId);
    if (!row.data.decision && row.data.state === "AWAITING_DANIEL") {
      if (
        row.data.expires_at &&
        Date.parse(row.data.expires_at) <= Date.now()
      ) {
        await expireCandidate(rpc, row.id);
        return { state: "EXPIRED" };
      }
      const token =
        row.data.wait_token_id ??
        (await attachWaitToken(
          rpc,
          row.id,
          (
            await wait.createToken({
              timeout: row.data.expires_at
                ? new Date(row.data.expires_at)
                : "30d",
              idempotencyKey: `review:${row.id}`,
              idempotencyKeyTTL: "30d",
            })
          ).id,
        ));
      // Covers decision arriving between token creation and attachment.
      row = await findReview(rpc, candidateId);
      if (row.data.decision)
        await wait.completeToken(token, { candidate_id: row.id });
      const result = await wait.forToken(token);
      if (!result.ok) {
        if (row.data.expires_at) {
          await expireCandidate(rpc, row.id);
          return { state: "EXPIRED" };
        }
        return { state: "AWAITING_DANIEL" };
      }
    }
    row = await findReview(rpc, candidateId);
    if (row.data.decision?.decision !== "approve")
      return { state: row.data.state };
    const due = row.data.frozen.due_at;
    if (due && Date.parse(due) > Date.now())
      await wait.until({ date: new Date(due) });
    const resumed = await resumeCandidate(rpc, row.id);
    // Existing leased immutable outbox; demo is forced to the simulator when the candidate is frozen.
    if (resumed.outbox_id) await processOutbox(rpc, row.is_demo);
    return resumed;
  },
});
// No cron attached: no new cadence is activated by deploying this module.
// This recovery boundary only resumes existing decisions; it never creates/approves content.
export const approvalRecovery = schedules.task({
  id: "approval-recovery",
  retry: { maxAttempts: 3 },
  run: async () => {
    cloudOnly();
    const rpc = await applicationRpc();
    let pending = 0;
    for (const demo of [false, true]) {
      const state = await readControl(rpc, demo);
      for (const e of state.entities.filter(
        (e) =>
          isReview(e) &&
          ["AWAITING_DANIEL", "APPROVED"].includes(String(e.data.state)),
      )) {
        const result = await wakeApproval(rpc, e.id);
        if (result.pending) pending++;
      }
    }
    if (pending) throw Error("CLOUD_RESUME_PENDING");
    return { pending };
  },
});
// Safe schedule proof: attaching a staging schedule with externalId=<demo package UUID>
// creates only a simulator candidate and pauses for authenticated approval.
export const stagingApprovalSchedule = schedules.task({
  id: "staging-approval-schedule",
  run: async ({ externalId }) => {
    cloudOnly();
    if (process.env.TRIGGER_ENVIRONMENT_TYPE !== "staging" || !externalId)
      throw Error("STAGING_PACKAGE_REQUIRED");
    const rpc = await applicationRpc();
    const row = await createCandidate(rpc, externalId, null, true);
    return { candidateId: row.id, wake: await wakeApproval(rpc, row.id) };
  },
});
