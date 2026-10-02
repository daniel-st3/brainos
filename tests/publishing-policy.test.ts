import { afterEach, it, expect, vi } from "vitest";
import { externalWritesAllowed } from "../src/providers/publishing-policy";
afterEach(() => vi.unstubAllEnvs());
it("requires explicit account authorization in plug-and-play mode", () => {
  vi.stubEnv("BRAINOS_EXTERNAL_PUBLISHING", "approval_required");
  expect(externalWritesAllowed({})).toBe(false);
  expect(externalWritesAllowed({ writes_authorized: true })).toBe(false);
  expect(
    externalWritesAllowed({
      writes_authorized: true,
      writes_authorized_by: "editor",
      writes_authorized_at: new Date().toISOString(),
    }),
  ).toBe(true);
});
it("emergency stop overrides even an approved account", () => {
  vi.stubEnv("BRAINOS_EXTERNAL_PUBLISHING", "disabled");
  expect(
    externalWritesAllowed({
      writes_authorized: true,
      writes_authorized_by: "editor",
      writes_authorized_at: new Date().toISOString(),
    }),
  ).toBe(false);
});
