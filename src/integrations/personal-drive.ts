/** BrainOS is personal infrastructure. Fail closed before touching any Drive folder. */
export const personalDriveRoot = "1ioH_s2oxNZni7OwG54TScSxSaC33zIje";
export const personalDriveEmail = "Danix3102@gmail.com";
export function personalDriveConfiguration() {
  if (process.env.GOOGLE_DRIVE_ROOT_ID !== personalDriveRoot)
    throw Error("BrainOS requires its configured personal Drive folder.");
  if (
    process.env.GOOGLE_DRIVE_ACCOUNT_EMAIL?.toLowerCase() !==
    personalDriveEmail.toLowerCase()
  )
    throw Error(
      "BrainOS requires the personal Google account Danix3102@gmail.com.",
    );
  return { root: personalDriveRoot, email: personalDriveEmail };
}
export async function verifyPersonalDrive(accessToken: string) {
  const config = personalDriveConfiguration();
  const headers = { Authorization: `Bearer ${accessToken}` };
  const account = await fetch(
    "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
    { headers, signal: AbortSignal.timeout(15000) },
  );
  if (!account.ok)
    throw Error(
      "Cannot verify Google account. Check that Google Drive API is enabled.",
    );
  const about = (await account.json()) as { user?: { emailAddress?: string } };
  if (about.user?.emailAddress?.toLowerCase() !== config.email.toLowerCase())
    throw Error(
      "Wrong Google account. Connect Danix3102@gmail.com; no Drive folder was accessed.",
    );
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${config.root}?fields=id,name,mimeType,ownedByMe,trashed,capabilities(canAddChildren)`,
    { headers, signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok)
    throw Error(
      "The personal Google account cannot access the personal BrainOS folder.",
    );
  const folder = (await response.json()) as {
    id: string;
    name: string;
    mimeType: string;
    ownedByMe?: boolean;
    trashed?: boolean;
    capabilities?: { canAddChildren?: boolean };
  };
  if (
    folder.id !== config.root ||
    folder.trashed ||
    !folder.ownedByMe ||
    folder.mimeType !== "application/vnd.google-apps.folder" ||
    !folder.capabilities?.canAddChildren
  )
    throw Error(
      "BrainOS requires a writable folder owned by the personal Google account.",
    );
  return { email: config.email, root: config.root, name: folder.name };
}
