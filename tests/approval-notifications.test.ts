import {
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import { approvalFixture } from "./approval-fixture";
import { createCandidate, decideCandidate } from "../src/approval/service";
import { readControl } from "../src/control/service";
import {
  gmailSendScope,
  googleDriveScope,
} from "../src/integrations/google-oauth";
import {
  personalDriveEmail,
  personalDriveRoot,
  fingerprint,
} from "./drive-fixture";
vi.mock("../src/integrations/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/integrations/media")>()),
  driveToken: vi.fn(async () => "fixture-access-never-live"),
}));
import {
  deliverReviewNotifications,
  notificationStatus,
  reviewEmail,
} from "../src/approval/notifications";
let db: PGlite, rpc: Rpc;
beforeAll(async () => {
  db = await initializeDb();
  await seedDb(db);
  rpc = localRpc(db);
}, 30000);
afterAll(async () => db.close());
beforeEach(() => {
  vi.stubEnv("CONTENT_OS_MODE", "supabase");
  vi.stubEnv("CONTENT_OS_ORIGIN", "https://brainos.example");
  vi.stubEnv("GOOGLE_CLIENT_ID", "fixture");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture");
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("GOOGLE_DRIVE_ROOT_ID", personalDriveRoot);
  vi.stubEnv("GOOGLE_DRIVE_ACCOUNT_EMAIL", personalDriveEmail);
  vi.stubEnv("GOOGLE_DRIVE_ROOT_FINGERPRINT", fingerprint(personalDriveRoot));
  vi.stubEnv(
    "GOOGLE_DRIVE_ACCOUNT_FINGERPRINT",
    fingerprint(personalDriveEmail.toLowerCase()),
  );
});
afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const f = await approvalFixture(rpc);
  return createCandidate(rpc, f.packageId, null, true);
}
async function authorize(scopes: string[]) {
  await rpc("save_google_connection", {
    p_ciphertext: "x".repeat(50),
    p_scopes: scopes,
    p_actor: "fixture",
  });
}
it("does not send or fall back to a connector without explicit Gmail send consent", async () => {
  await fixture();
  await authorize([googleDriveScope]);
  const send = vi.fn();
  expect(await notificationStatus(rpc)).toBe("GMAIL_CONSENT_REQUIRED");
  expect((await deliverReviewNotifications(rpc, true, send)).sent).toBe(0);
  expect(send).not.toHaveBeenCalled();
});
it("uses fixed personal recipient, minimal message, concurrent CAS and retained Gmail receipt", async () => {
  const row = await fixture();
  await authorize([googleDriveScope, gmailSendScope]);
  const mime = Buffer.from(reviewEmail(row), "base64url").toString();
  expect(mime).toContain(`To: ${personalDriveEmail}`);
  const body = Buffer.from(mime.split("\r\n\r\n")[1], "base64").toString();
  expect(body).toContain(`https://brainos.example/review/${row.id}`);
  expect(body).not.toContain(row.data.checksum);
  expect(body).not.toContain("access");
  const send = vi.fn(
    async () =>
      new Response(JSON.stringify({ id: "gmail-fixture" }), { status: 200 }),
  );
  await Promise.all([
    deliverReviewNotifications(rpc, true, send),
    deliverReviewNotifications(rpc, true, send),
  ]);
  const before = send.mock.calls.length;
  await deliverReviewNotifications(rpc, true, send);
  expect(send.mock.calls.length).toBe(before);
  const n = (await readControl(rpc, true)).entities.find(
    (e) => e.kind === "notification" && e.parent_id === row.id,
  )!;
  expect(n.data.external_delivery).toBe("SENT");
  expect(n.data.external_id).toBe("gmail-fixture");
  // Exactly one call per ready notification even under concurrent workers.
  const notifications = (await readControl(rpc, true)).entities.filter(
    (e) => e.kind === "notification" && e.data.external_delivery === "SENT",
  );
  expect(send).toHaveBeenCalledTimes(notifications.length);
});
it("ambiguous send is retained as UNKNOWN and never automatically resent", async () => {
  const row = await fixture();
  await authorize([googleDriveScope, gmailSendScope]);
  const send = vi.fn(async () => {
    throw Error("timeout bearer-secret");
  });
  await deliverReviewNotifications(rpc, true, send);
  await deliverReviewNotifications(rpc, true, send);
  expect(send).toHaveBeenCalledTimes(1);
  const n = (await readControl(rpc, true)).entities.find(
    (e) => e.kind === "notification" && e.parent_id === row.id,
  )!;
  expect(n.data.external_delivery).toBe("UNKNOWN");
  expect(JSON.stringify(n)).not.toContain("bearer-secret");
});
it("rejected candidate never sends a ready-for-review email", async () => {
  const row = await fixture();
  await decideCandidate(
    rpc,
    row.id,
    { checksum: row.data.checksum, decision: "reject" },
    "fixture",
  );
  const send = vi.fn();
  await deliverReviewNotifications(rpc, true, send);
  expect(send).not.toHaveBeenCalled();
});
