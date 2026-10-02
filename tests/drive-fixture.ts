import { createHash } from "node:crypto";
export const personalDriveRoot = "demo-personal-folder-only";
export const personalDriveEmail = "brainos-demo@gmail.com";
export const fingerprint = (v: string) =>
  createHash("sha256").update(v).digest("hex");
