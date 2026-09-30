import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Story } from "@/domain/types";
import { localDb } from "./local-db";
export const isConnected = () => process.env.CONTENT_OS_MODE === "supabase";
function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new Error("Supabase mode requires URL and server secret key.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function readStories(): Promise<Story[]> {
  if (isConnected()) {
    const { data, error } = await supabase().rpc("read_newsroom");
    if (error) throw new Error(error.message);
    return data as Story[];
  }
  const db = await localDb();
  const result = await db.query<{ data: Story[] }>(
    "select read_newsroom() as data",
  );
  return result.rows[0].data;
}
export async function saveStory(story: Story, expectedVersion: number) {
  if (isConnected()) {
    const { error } = await supabase().rpc("save_story", {
      p_story: story,
      p_expected_version: expectedVersion,
    });
    if (error) throw new Error(error.message);
    return;
  }
  const db = await localDb();
  await db.query("select save_story($1::jsonb,$2)", [
    JSON.stringify(story),
    expectedVersion,
  ]);
}
