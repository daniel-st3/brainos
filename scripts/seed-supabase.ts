import { createClient } from "@supabase/supabase-js";
import { createDemoStories } from "../src/domain/seed";
if (!process.argv.includes("--confirm"))
  throw new Error(
    "This adds fictional demo records to the configured Supabase project. Pass --confirm intentionally.",
  );
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key)
  throw new Error("Supabase URL and server secret key are required.");
const client = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await client.rpc("read_newsroom");
if (error) throw error;
if (data?.length)
  throw new Error(
    "Refusing to seed a nonempty newsroom. Existing records are preserved.",
  );
for (const s of createDemoStories()) {
  const { error } = await client.rpc("save_story", {
    p_story: s,
    p_expected_version: -1,
  });
  if (error) throw error;
}
console.log("Seven clearly labeled demo stories added.");
