/** BrainOS is personal infrastructure. Fail closed before touching any Drive folder. */
import { createHash } from "node:crypto";
export function personalDriveConfiguration() {
  const root = process.env.GOOGLE_DRIVE_ROOT_ID ?? "",
    email = process.env.GOOGLE_DRIVE_ACCOUNT_EMAIL ?? "";
  const digest = (v: string) => createHash("sha256").update(v).digest("hex");
  if (
    !/^[A-Za-z0-9_-]{10,200}$/.test(root) ||
    !process.env.GOOGLE_DRIVE_ROOT_FINGERPRINT ||
    digest(root) !== process.env.GOOGLE_DRIVE_ROOT_FINGERPRINT
  )
    throw Error("BrainOS requires its configured personal Drive folder.");
  if (
    !email.toLowerCase().endsWith("@gmail.com") ||
    !process.env.GOOGLE_DRIVE_ACCOUNT_FINGERPRINT ||
    digest(email.toLowerCase()) !== process.env.GOOGLE_DRIVE_ACCOUNT_FINGERPRINT
  )
    throw Error("BrainOS requires its approved personal Google account.");
  return { root, email };
}
/** Only Drive error JSON is exposed, never headers or OAuth token responses. */
export class DriveVerificationError extends Error {
  constructor(
    public readonly diagnostic: {
      call: string;
      method: "GET";
      url: string;
      status: number;
      response: unknown;
      verifiedAccount?: string;
    },
  ) {
    super(`Drive ${diagnostic.call} failed (HTTP ${diagnostic.status}).`);
  }
}
export async function verifyPersonalDrive(
  accessToken: string,
  listChildren = false,
) {
  const config = personalDriveConfiguration();
  const headers = { Authorization: `Bearer ${accessToken}` };
  async function read(call: string, url: string, verifiedAccount?: string) {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const safe =
        body?.error && typeof body.error === "object"
          ? { error: body.error }
          : { error: "Non-JSON Drive error response" };
      throw new DriveVerificationError({
        call,
        method: "GET",
        url,
        status: response.status,
        response: safe,
        verifiedAccount,
      });
    }
    return body;
  }
  const about = await read(
    "about.get",
    "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
  );
  if (about?.user?.emailAddress?.toLowerCase() !== config.email.toLowerCase())
    throw Error(
      "Wrong Google account. Connect the approved personal account; no Drive folder was accessed.",
    );
  const verifiedAccount = about.user.emailAddress;
  const folder = await read(
    "files.get",
    `https://www.googleapis.com/drive/v3/files/${config.root}?fields=id,name,mimeType,ownedByMe,trashed,capabilities(canAddChildren)`,
    verifiedAccount,
  );
  if (
    folder?.id !== config.root ||
    folder.trashed ||
    folder.mimeType !== "application/vnd.google-apps.folder" ||
    !folder.capabilities?.canAddChildren
  )
    throw Error(
      "BrainOS requires the exact personal root to be an active folder with write access (canAddChildren). Ownership is not required.",
    );
  if (listChildren) {
    const query = new URLSearchParams({
      q: `'${config.root}' in parents and trashed = false`,
      fields: "files(id),nextPageToken",
      pageSize: "1",
    });
    await read(
      "files.list",
      `https://www.googleapis.com/drive/v3/files?${query}`,
      verifiedAccount,
    );
  }
  return { email: config.email, root: config.root, name: folder.name };
}
