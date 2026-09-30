import { NextResponse } from "next/server";
import { editor } from "@/server/auth";
import { readStories } from "@/server/repository";
export async function GET() {
  try {
    await editor();
    return NextResponse.json(await readStories(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load newsroom." },
      { status: 401 },
    );
  }
}
