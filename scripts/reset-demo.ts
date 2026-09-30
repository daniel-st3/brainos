import { rm } from "node:fs/promises";
import path from "node:path";
if (process.env.CONTENT_OS_MODE === "supabase")
  throw new Error("Reset is only available for local demo storage.");
if (!process.argv.includes("--confirm"))
  throw new Error(
    "Stop the app first, then use npm run db:reset -- --confirm to delete local demo edits.",
  );
await rm(
  process.env.CONTENT_OS_DATA_DIR ?? path.join(process.cwd(), ".data/newsroom"),
  { recursive: true, force: true },
);
console.log("Local demo cleared. The app will reseed on restart.");
