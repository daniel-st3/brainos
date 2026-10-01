import { createClient } from "@supabase/supabase-js";
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "CONTENT_OS_EDITOR_ID",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length)
  throw new Error(`Missing runtime settings: ${missing.join(", ")}`);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const server = createClient(url, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
for (const name of [
  "read_newsroom",
  "read_discovery_state",
  "read_pilot_study",
  "read_operations",
]) {
  const { error } = await server.rpc(name);
  if (error) throw new Error(`${name}: ${error.message}`);
  console.log(`${name}: remote RPC verified`);
}
const anon = createClient(
  url,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { persistSession: false } },
);
const { error } = await anon.rpc("read_newsroom");
if (!error) throw new Error("Anonymous access was not blocked!");
const { data: user, error: authError } = await server.auth.admin.getUserById(
  process.env.CONTENT_OS_EDITOR_ID!,
);
if (authError || !user.user) throw new Error("Configured editor is missing.");
console.log("Anonymous database access denied; configured editor exists.");
