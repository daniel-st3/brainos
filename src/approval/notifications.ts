import { issueReviewLink } from "./review-link";
import type { Rpc } from "../ingestion/store";
import { readControl } from "../control/service";
import type { Entity } from "../control/model";
import {
  gmailSendScope,
  oauthConfiguration,
} from "../integrations/google-oauth";
import { driveToken, type SavedDriveConnection } from "../integrations/media";
import { personalDriveConfiguration } from "../integrations/personal-drive";
import { isReview, type Review } from "./service";
type Connection = SavedDriveConnection & { scopes: string[] };
export async function notificationStatus(rpc: Rpc) {
  const connection = (await rpc("read_google_connection")) as Connection | null;
  return connection?.scopes?.includes(gmailSendScope)
    ? "GMAIL_AUTHORIZED"
    : "GMAIL_CONSENT_REQUIRED";
}
/** Fixed recipient and fixed server origin; no user-supplied address, headers, or approval tokens. */
export function reviewEmail(row: Review) {
  const { email } = personalDriveConfiguration();
  if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(email))
    throw Error("PERSONAL_EMAIL_REQUIRED");
  const { origin } = oauthConfiguration();
  const reviewPath =
    process.env.BRAINOS_EMAIL_REVIEW_LINKS === "true"
      ? `/review-link/${row.id}#${issueReviewLink(row)}`
      : `/review/${row.id}`;
  const body = `${row.is_demo ? "SIMULATION — no social publication\n" : ""}${row.data.frozen.title}\n\nReview:\n${origin}${reviewPath}`;
  return Buffer.from(
    [
      `From: ${email}`,
      `To: ${email}`,
      "Subject: DVNI post ready for review",
      `Message-ID: <brainos-review-${row.id}@${new URL(origin).hostname}>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(body).toString("base64"),
    ].join("\r\n"),
  ).toString("base64url");
}
async function update(
  rpc: Rpc,
  notification: Entity,
  patch: Record<string, unknown>,
) {
  const state = await readControl(rpc, notification.is_demo);
  const current = state.entities.find((e) => e.id === notification.id);
  if (!current || current.version !== notification.version)
    throw Error("NOTIFICATION_CLAIM_LOST");
  const next = {
    ...current,
    version: current.version + 1,
    data: { ...current.data, ...patch },
  };
  await rpc("commit_control", {
    p_epoch: state.epoch,
    p_entities: [next],
    p_jobs: [],
    p_public: [],
    p_actor: "review-email",
  });
  return next;
}
/** CAS claim prevents concurrent sends. Ambiguous outcomes are retained, never blindly retried.
 * Gmail send has no idempotency API. We cannot promise exactly-once external delivery.
 */
export async function deliverReviewNotifications(
  rpc: Rpc,
  demo: boolean,
  send: typeof fetch = fetch,
  candidateId?: string,
) {
  const connection = (await rpc("read_google_connection")) as Connection | null;
  if (!connection?.scopes?.includes(gmailSendScope))
    return { status: "GMAIL_CONSENT_REQUIRED", sent: 0 };
  const state = await readControl(rpc, demo);
  let sent = 0;
  const deadline = Date.now() + 30000;
  for (const notification of state.entities.filter(
    (e) =>
      e.kind === "notification" && String(e.data.key).startsWith("approval:"),
  )) {
    if (Date.now() >= deadline) break;
    if (candidateId && notification.parent_id !== candidateId) continue;
    const row = state.entities.find(
      (e) => e.id === notification.parent_id && isReview(e),
    ) as unknown as Review | undefined;
    if (
      !row ||
      row.data.state !== "AWAITING_DANIEL" ||
      row.data.decision ||
      (row.data.expires_at && Date.parse(row.data.expires_at) <= Date.now())
    )
      continue;
    if (
      ["SENT", "UNKNOWN"].includes(String(notification.data.external_delivery))
    )
      continue;
    if (notification.data.external_delivery === "SENDING") {
      if (
        Date.parse(String(notification.data.attempted_at)) <
        Date.now() - 120000
      )
        await update(rpc, notification, {
          external_delivery: "UNKNOWN",
          error: "DELIVERY_OUTCOME_UNKNOWN",
        }).catch(() => {});
      continue;
    }
    if (Number(notification.data.next_attempt_at ?? 0) > Date.now()) continue;
    // Acquire access and construct MIME before claiming; these steps cannot send email.
    let access: string, raw: string;
    try {
      access = await driveToken(connection);
      raw = reviewEmail(row);
    } catch {
      await update(rpc, notification, {
        external_delivery: "BLOCKED",
        error: "GOOGLE_SEND_AUTHORIZATION_OR_CONFIGURATION_REQUIRED",
        next_attempt_at: Date.now() + 3600000,
      }).catch(() => {});
      continue;
    }
    let claimed: Entity;
    try {
      claimed = await update(rpc, notification, {
        external_delivery: "SENDING",
        transport: "gmail",
        attempted_at: new Date().toISOString(),
      });
    } catch {
      continue;
    }
    try {
      const response = await send(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) {
        // 5xx may have accepted the write; require inspection instead of duplicating it.
        await update(rpc, claimed, {
          external_delivery: response.status >= 500 ? "UNKNOWN" : "BLOCKED",
          error: `GMAIL_SEND_HTTP_${response.status}`,
          next_attempt_at: Date.now() + 3600000,
        });
        continue;
      }
      const result = (await response.json()) as { id?: string };
      if (!result.id) throw Error("MISSING_RECEIPT");
      await update(rpc, claimed, {
        external_delivery: "SENT",
        external_id: result.id,
        sent_at: new Date().toISOString(),
        error: null,
      });
      sent++;
    } catch {
      await update(rpc, claimed, {
        external_delivery: "UNKNOWN",
        error: "DELIVERY_OUTCOME_UNKNOWN",
      }).catch(() => {});
    }
  }
  return { status: "CHECKED", sent };
}
