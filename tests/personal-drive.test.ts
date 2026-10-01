import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  personalDriveRoot,
  personalDriveEmail,
  verifyPersonalDrive,
  personalDriveConfiguration,
} from "../src/integrations/personal-drive";
import { driveInfo } from "../src/production/storage";
beforeEach(() => {
  vi.stubEnv("GOOGLE_DRIVE_ROOT_ID", personalDriveRoot);
  vi.stubEnv("GOOGLE_DRIVE_ACCOUNT_EMAIL", personalDriveEmail);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const folder = () => ({
  id: personalDriveRoot,
  name: "Daniel AI Content OS",
  mimeType: "application/vnd.google-apps.folder",
  ownedByMe: true,
  capabilities: { canAddChildren: true },
});
it("rejects a different configured root before any network access", async () => {
  const call = vi.fn();
  vi.stubGlobal("fetch", call);
  vi.stubEnv("GOOGLE_DRIVE_ROOT_ID", "unapproved-folder");
  expect(() => personalDriveConfiguration()).toThrow("personal Drive");
  await expect(verifyPersonalDrive("test")).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
it("rejects the wrong Google account before accessing any folder", async () => {
  const call = vi
    .fn()
    .mockResolvedValue(
      Response.json({ user: { emailAddress: "other@example.com" } }),
    );
  vi.stubGlobal("fetch", call);
  await expect(verifyPersonalDrive("test")).rejects.toThrow(
    "Wrong Google account",
  );
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0][0]).toContain("/about?");
});
it("requires personal ownership of the exact root, not merely shared write access", async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ user: { emailAddress: personalDriveEmail } }),
    )
    .mockResolvedValueOnce(Response.json({ ...folder(), ownedByMe: false }));
  vi.stubGlobal("fetch", call);
  await expect(verifyPersonalDrive("test")).rejects.toThrow(
    "owned by the personal",
  );
});
it("accepts personal identity and exact writable root", async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        user: { emailAddress: personalDriveEmail.toLowerCase() },
      }),
    )
    .mockResolvedValueOnce(Response.json(folder()));
  vi.stubGlobal("fetch", call);
  expect(await verifyPersonalDrive("test")).toEqual({
    email: personalDriveEmail,
    root: personalDriveRoot,
    name: "Daniel AI Content OS",
  });
  expect(call.mock.calls[1][0]).toContain("/files/" + personalDriveRoot + "?");
});
it("rejects linking media outside the personal root before download", async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "fixture");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture");
  vi.stubEnv("GOOGLE_REFRESH_TOKEN", "fixture");
  const call = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: "fixture" }))
    .mockResolvedValueOnce(
      Response.json({ user: { emailAddress: personalDriveEmail } }),
    )
    .mockResolvedValueOnce(Response.json(folder()))
    .mockResolvedValueOnce(
      Response.json({
        id: "different-file-123",
        name: "unrelated.mp4",
        mimeType: "video/mp4",
        size: "100",
        parents: [],
      }),
    );
  vi.stubGlobal("fetch", call);
  await expect(driveInfo("different-file-123")).rejects.toThrow(
    "configured Daniel-owned Drive root",
  );
  expect(
    call.mock.calls.every((c) => !String(c[0]).includes("alt=media")),
  ).toBe(true);
});
