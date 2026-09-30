import { redirect } from "next/navigation";
import { editor } from "./auth";
import { readStories } from "./repository";
export async function newsroom() {
  try {
    await editor();
  } catch {
    redirect("/login");
  }
  return readStories();
}
