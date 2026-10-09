import { NextResponse } from "next/server";
import { sameOrigin } from "@/server/request";
import { applicationRpc } from "@/ingestion/store";
import { findReview } from "@/approval/service";
import { reviewCookie, verifyReviewLink } from "@/approval/review-link";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  try {
    const id = (await context.params).id,
      text = await request.text();
    if (text.length > 3500) throw Error("Unauthorized");
    const { token } = JSON.parse(text);
    const grant = verifyReviewLink(
      token,
      await findReview(await applicationRpc(), id),
    );
    const response = NextResponse.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
    response.cookies.set(reviewCookie(id), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: `/api/approvals/${id}`,
      expires: new Date(grant.expires),
    });
    return response;
  } catch {
    return NextResponse.json(
      {
        error:
          "This review link is invalid or expired. Open the latest review email.",
      },
      { status: 401 },
    );
  }
}
