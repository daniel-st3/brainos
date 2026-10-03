import { afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  decide: vi.fn(),
  resume: vi.fn(),
}));
vi.mock("@/server/auth", () => ({
  editor: async () => "authenticated-editor",
}));
vi.mock("@/ingestion/store", () => ({ applicationRpc: async () => vi.fn() }));
vi.mock("@/approval/service", () => ({
  decideCandidate: h.decide,
  resumeCandidate: h.resume,
  findReview: vi.fn(),
  assertCurrent: vi.fn(),
}));
vi.mock("@/approval/notifications", () => ({
  notificationStatus: async () => "GMAIL_CONSENT_REQUIRED",
}));
vi.mock("@/approval/runtime", () => {
  throw Error("Production route must not load Trigger runtime");
});
vi.mock("@/providers/outbox", () => {
  throw Error("Approval HTTP must not dispatch providers");
});
import { POST } from "../src/app/api/approvals/[id]/route";
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
function request(decision = "approve") {
  return new Request("https://brainos.example/api/approvals/id", {
    method: "POST",
    headers: {
      Origin: "https://brainos.example",
      Host: "brainos.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ decision, checksum: "a".repeat(64) }),
  });
}
it("live approval succeeds without Trigger and returns only after durable enqueue", async () => {
  vi.stubEnv("TRIGGER_SECRET_KEY", "");
  vi.stubEnv("TRIGGER_PROJECT_REF", "");
  h.decide.mockResolvedValue({
    is_demo: false,
    data: { decision: { decision: "approve" } },
  });
  h.resume.mockResolvedValue({ state: "QUEUED", outbox_id: "durable-outbox" });
  const r = await POST(request(), {
    params: Promise.resolve({ id: "candidate" }),
  });
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({
    saved: true,
    simulated: false,
    state: "QUEUED",
    outbox_id: "durable-outbox",
  });
  expect(h.decide).toHaveBeenCalledWith(
    expect.any(Function),
    "candidate",
    expect.objectContaining({ decision: "approve" }),
    "authenticated-editor",
  );
  expect(h.resume).toHaveBeenCalledWith(expect.any(Function), "candidate");
});
it.each(["reject", "request_changes"])(
  "%s cannot enqueue",
  async (decision) => {
    h.decide.mockResolvedValue({
      is_demo: false,
      data: { state: decision.toUpperCase(), decision: { decision } },
    });
    const r = await POST(request(decision), {
      params: Promise.resolve({ id: "candidate" }),
    });
    expect(r.status).toBe(200);
    expect(h.resume).not.toHaveBeenCalled();
    expect((await r.json()).outbox_id).toBeNull();
  },
);
it("enqueue interruption never returns false success", async () => {
  h.decide.mockResolvedValue({
    is_demo: false,
    data: { decision: { decision: "approve" } },
  });
  h.resume.mockRejectedValue(Error("connection-lost secret"));
  const r = await POST(request(), {
    params: Promise.resolve({ id: "candidate" }),
  });
  expect(r.status).toBe(409);
  expect(await r.text()).not.toContain("connection-lost secret");
});
