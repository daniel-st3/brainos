import { afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  create: vi.fn(async (key: string) => key),
  trigger: vi.fn(async () => ({ id: "run_fixture" })),
  complete: vi.fn(async () => ({ success: true })),
}));
vi.mock("@trigger.dev/sdk", () => ({
  idempotencyKeys: { create: h.create },
  tasks: { trigger: h.trigger },
  wait: { completeToken: h.complete },
}));
vi.mock("../src/approval/service", () => ({
  findReview: async () => ({
    data: {
      wait_token_id: "waitpoint_fixture",
      decision: { decision: "approve" },
    },
  }),
}));
import { wakeApproval } from "../src/approval/runtime";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("recovery and HTTP wake share a global idempotency key independent of parent run", async () => {
  vi.stubEnv("TRIGGER_PROJECT_REF", "fixture");
  vi.stubEnv("TRIGGER_SECRET_KEY", "fixture-not-a-token");
  const rpc = vi.fn();
  await wakeApproval(rpc, "candidate_fixture");
  await wakeApproval(rpc, "candidate_fixture");
  expect(h.create).toHaveBeenCalledWith("approval:candidate_fixture:decided", {
    scope: "global",
  });
  expect(h.trigger.mock.calls[0]).toEqual(h.trigger.mock.calls[1]);
});
it("a failed token completion can still replay the durable decision", async () => {
  vi.stubEnv("TRIGGER_PROJECT_REF", "fixture");
  vi.stubEnv("TRIGGER_SECRET_KEY", "fixture-not-a-token");
  h.complete.mockRejectedValueOnce(Error("Expired token"));
  expect((await wakeApproval(vi.fn(), "candidate_fixture")).pending).toBe(
    false,
  );
  expect(h.trigger).toHaveBeenCalledOnce();
});
it("missing runtime never sends an external request", async () => {
  vi.stubEnv("TRIGGER_SECRET_KEY", "");
  expect((await wakeApproval(vi.fn(), "candidate_fixture")).reason).toBe(
    "TRIGGER_RUNTIME_NOT_CONFIGURED",
  );
  expect(h.trigger).not.toHaveBeenCalled();
});
