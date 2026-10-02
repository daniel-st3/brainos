import {
  personalDriveRoot,
  personalDriveEmail,
  fingerprint,
} from "./drive-fixture";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DriveVerificationError,
  verifyPersonalDrive,
  personalDriveConfiguration,
} from "../src/integrations/personal-drive";
import { driveInfo } from "../src/production/storage";
beforeEach(() => {
  vi.stubEnv("GOOGLE_DRIVE_ROOT_FINGERPRINT", fingerprint(personalDriveRoot));
  vi.stubEnv(
    "GOOGLE_DRIVE_ACCOUNT_FINGERPRINT",
    fingerprint(personalDriveEmail.toLowerCase()),
  );
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
it("accepts shared write access to the exact root without ownership", async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ user: { emailAddress: personalDriveEmail } }),
    )
    .mockResolvedValueOnce(Response.json({ ...folder(), ownedByMe: false }));
  vi.stubGlobal("fetch", call);
  await expect(verifyPersonalDrive("test")).resolves.toMatchObject({
    root: personalDriveRoot,
  });
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

it("rejects a read-only folder even if personally owned", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ user: { emailAddress: personalDriveEmail } }),
      )
      .mockResolvedValueOnce(
        Response.json({ ...folder(), capabilities: { canAddChildren: false } }),
      ),
  );
  await expect(verifyPersonalDrive("test")).rejects.toThrow("write access");
});
it("lists only the exact root's children during consent verification", async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ user: { emailAddress: personalDriveEmail } }),
    )
    .mockResolvedValueOnce(Response.json(folder()))
    .mockResolvedValueOnce(Response.json({ files: [] }));
  vi.stubGlobal("fetch", call);
  await verifyPersonalDrive("test", true);
  expect(new URL(call.mock.calls[2][0]).searchParams.get("q")).toBe(
    `'${personalDriveRoot}' in parents and trashed = false`,
  );
  expect(
    call.mock.calls.every(
      ([, options]) => !options.method && options.cache === "no-store",
    ),
  ).toBe(true);
});
it.each(["files.get", "files.list"])(
  "preserves the exact %s failure without credentials",
  async (operation) => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ user: { emailAddress: personalDriveEmail } }),
      );
    if (operation === "files.list")
      call.mockResolvedValueOnce(Response.json(folder()));
    const body = {
      error: {
        code: 404,
        message: "File not found",
        errors: [{ reason: "notFound", domain: "global" }],
      },
    };
    call.mockResolvedValueOnce(Response.json(body, { status: 404 }));
    vi.stubGlobal("fetch", call);
    try {
      await verifyPersonalDrive("secret-access-token", true);
      throw Error("Expected failure");
    } catch (e) {
      expect(e).toBeInstanceOf(DriveVerificationError);
      const d = (e as DriveVerificationError).diagnostic;
      expect(d).toMatchObject({
        call: operation,
        method: "GET",
        status: 404,
        response: body,
        verifiedAccount: personalDriveEmail,
      });
      expect(d.url).toContain(personalDriveRoot);
      expect(JSON.stringify(d)).not.toContain("secret-access-token");
    }
  },
);
