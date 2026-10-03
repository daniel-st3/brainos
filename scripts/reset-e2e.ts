import { rm, writeFile } from "node:fs/promises";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc } from "../src/ingestion/store";
import { approvalFixture } from "../tests/approval-fixture";
import { createCandidate } from "../src/approval/service";
await rm(".data/e2e", { recursive: true, force: true });
await rm(".data/e2e-approval", { recursive: true, force: true });
const db = await initializeDb(".data/e2e-approval");
try {
  await seedDb(db);
  const rpc = localRpc(db),
    candidates: Record<string, string> = {};
  for (const decision of ["approve", "reject", "request_changes"]) {
    const f = await approvalFixture(rpc, decision === "approve");
    candidates[decision] = (
      await createCandidate(rpc, f.packageId, null, true)
    ).id;
  }
  await writeFile(".data/e2e-approvals.json", JSON.stringify(candidates), {
    mode: 0o600,
  });
} finally {
  await db.close();
}
