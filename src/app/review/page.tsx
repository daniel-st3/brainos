import Link from "next/link";
import { notificationStatus } from "@/approval/notifications";
import { readControl } from "@/control/service";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
import { isReview } from "@/approval/service";
import type { Candidate } from "@/approval/model";
import { newsroom } from "@/server/data";
import { PageHeader, Empty } from "@/components/ui";
import { ReviewPackage } from "@/components/story-panels";
export default async function Review() {
  const stories = (await newsroom()).filter(
    (s) => s.status === "review" && !s.archived,
  );
  const state = await readControl(
    await applicationRpc(),
    dataMode() === "demo",
  );
  const candidates = state.entities.filter(isReview);
  const email = await notificationStatus(await applicationRpc());
  return (
    <>
      <PageHeader
        eyebrow="REVIEW / 03"
        title="The final editorial call."
        description="Evidence, copy, angle and rights. One package. One exact revision."
      />
      <p role="status">
        {email === "GMAIL_AUTHORIZED" ? (
          "Review email authorized. Delivery status is retained with each notification."
        ) : (
          <>
            Review email needs Google send consent.{" "}
            <a href="/api/integrations/google/start?notifications=true">
              Enable review email
            </a>
          </>
        )}
      </p>
      <section aria-label="Publication decisions">
        {candidates.map((e) => (
          <p key={e.id}>
            <Link href={`/review/${e.id}`}>
              {(e.data.frozen as Candidate["frozen"]).title}
            </Link>{" "}
            · {String(e.data.state).replaceAll("_", " ")}
          </p>
        ))}
      </section>
      <div className="results-label">
        {stories.length} PACKAGES AWAITING YOUR DECISION
      </div>
      {stories.map((s) => (
        <div className="review-package" key={s.id}>
          <ReviewPackage story={s} />
        </div>
      ))}
      {!stories.length && (
        <Empty title="Your review desk is clear">
          Send a prepared recording or render package to review from its story
          workspace.
        </Empty>
      )}
    </>
  );
}
