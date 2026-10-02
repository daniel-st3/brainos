import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { driveConnectionStatus } from "../src/integrations/drive-status";
import { driveToken } from "../src/integrations/media";
import {
  personalDriveRoot,
  personalDriveEmail,
} from "../src/integrations/personal-drive";
vi.mock("../src/integrations/media", () => ({ driveToken: vi.fn() }));
beforeEach(() => {
  vi.stubEnv("CONTENT_OS_MODE", "supabase");
  vi.stubEnv("CONTENT_OS_ORIGIN", "https://brainos.example");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("GOOGLE_DRIVE_ROOT_ID", personalDriveRoot);
  vi.stubEnv("GOOGLE_DRIVE_ACCOUNT_EMAIL", personalDriveEmail);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
it("does not mistake configured OAuth or a success URL for saved consent", async () => {
  const rpc = vi.fn().mockResolvedValue(null);
  expect(await driveConnectionStatus(rpc)).toEqual({ state: "disconnected" });
  expect(driveToken).not.toHaveBeenCalled();
});
it("only reports connected after a runtime check and never returns credentials", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ encrypted_refresh_token: "private-ciphertext" });
  vi.mocked(driveToken).mockResolvedValue("private-access-token");
  expect(await driveConnectionStatus(rpc)).toEqual({
    state: "connected",
    email: personalDriveEmail,
    root: personalDriveRoot,
  });
  expect(driveToken).toHaveBeenCalledOnce();
});
it("does not show connected for a revoked token or failed folder check", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ encrypted_refresh_token: "private-ciphertext" });
  vi.mocked(driveToken).mockRejectedValue(Error("sensitive provider details"));
  expect(await driveConnectionStatus(rpc)).toEqual({ state: "unavailable" });
});
it("keeps the studio available if the connection lookup fails", async () => {
  expect(
    await driveConnectionStatus(
      vi.fn().mockRejectedValue(Error("database unavailable")),
    ),
  ).toEqual({ state: "unavailable" });
  expect(driveToken).not.toHaveBeenCalled();
});
it("does not contact Google when configuration is missing or the root is wrong", async () => {
  vi.stubEnv("GOOGLE_DRIVE_ROOT_ID", "wrong-root");
  const rpc = vi.fn();
  expect(await driveConnectionStatus(rpc)).toEqual({ state: "unconfigured" });
  expect(rpc).not.toHaveBeenCalled();
  expect(driveToken).not.toHaveBeenCalled();
});
