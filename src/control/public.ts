import { createHash, randomBytes } from "node:crypto";
import type { Rpc } from "../ingestion/store";
export interface PublicRecord {
  id: string;
  kind: "profile" | "content" | "build" | "link";
  title: string;
  description: string;
  url: string | null;
  body: string;
}
export async function publicRecords(rpc: Rpc, demo = false) {
  return (await rpc("read_public_surface", { p_demo: demo })) as PublicRecord[];
}
export async function signup(rpc: Rpc, email: string, consent: boolean) {
  if (!consent || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254)
    throw Error("Email and explicit consent required");
  const token = randomBytes(32).toString("hex");
  await rpc("signup_subscriber", {
    p_email: email,
    p_source: "public-site",
    p_hash: createHash("sha256").update(token).digest("hex"),
    p_privacy: "2026-10-02/v1",
  });
  return token;
}
export async function unsubscribe(rpc: Rpc, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw Error("Invalid unsubscribe reference");
  await rpc("unsubscribe_subscriber", {
    p_hash: createHash("sha256").update(token).digest("hex"),
  });
}
