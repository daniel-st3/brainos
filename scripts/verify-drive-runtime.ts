/** Authorized runtime check. Creates/removes only its own temporary file, never a folder. */
import { driveToken } from "../src/integrations/media";
import { driveInfo } from "../src/production/storage";
const root = process.env.GOOGLE_DRIVE_ROOT_ID;
if (root !== "1ioH_s2oxNZni7OwG54TScSxSaC33zIje")
  throw Error("Expected existing Daniel AI Content OS root");
const token = await driveToken();
const headers = { Authorization: `Bearer ${token}` };
const info = await fetch(
  `https://www.googleapis.com/drive/v3/files/${root}?fields=id,name,mimeType,capabilities(canAddChildren),trashed`,
  { headers },
);
if (!info.ok) throw Error(`Root access failed: HTTP ${info.status}`);
const folder = await info.json();
if (
  folder.trashed ||
  folder.mimeType !== "application/vnd.google-apps.folder" ||
  !folder.capabilities?.canAddChildren
)
  throw Error("Existing root unavailable for uploads");
const marker = crypto.randomUUID(),
  name = `BRAINOS-VERIFICATION-${marker}.txt`,
  text = `Temporary BrainOS Drive runtime verification ${marker}`;
const boundary = `brainos_${marker}`;
const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [root], description: "Temporary runtime check; safe to remove after verification." })}\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--${boundary}--\r\n`;
const created = await fetch(
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
  {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  },
);
if (!created.ok) throw Error(`Drive upload failed: HTTP ${created.status}`);
const { id } = await created.json();
if (!/^[A-Za-z0-9_-]+$/.test(id))
  throw Error("Drive did not return a stable ID");
try {
  const linked = await driveInfo(id);
  if (linked.file.id !== id || !linked.file.parents?.includes(root))
    throw Error("Stable-ID link/root verification failed");
  const download = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
    { headers },
  );
  if (!download.ok || (await download.text()) !== text)
    throw Error("Drive download did not match uploaded content");
  console.log(
    "Verified app OAuth, existing root, upload, stable-ID link, and download. No folders created.",
  );
} finally {
  const removed = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}`,
    { method: "DELETE", headers },
  );
  if (!removed.ok)
    throw Error(`Remove only this verification file manually: ${name} (${id})`);
  console.log("Temporary verification file removed.");
}
