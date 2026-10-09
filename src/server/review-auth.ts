import "server-only";
import { cookies } from "next/headers";
import { editor } from "./auth";
import { applicationRpc } from "../ingestion/store";
import { findReview } from "../approval/service";
import { reviewCookie, verifyReviewLink } from "../approval/review-link";
/** Candidate capability never authorizes another route, account, or candidate. */
export async function reviewActor(id: string) {
  try {
    return { actor: await editor(), audit: undefined };
  } catch {}
  try {
    const token = (await cookies()).get(reviewCookie(id))?.value;
    if (!token) throw Error("Unauthorized");
    return verifyReviewLink(
      token,
      await findReview(await applicationRpc(), id),
    );
  } catch {
    throw Error("Unauthorized");
  }
}
