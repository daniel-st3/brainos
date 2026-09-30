import { newsroom } from "@/server/data";
import { PageHeader, Empty } from "@/components/ui";
import { ReviewPackage } from "@/components/story-panels";
export default async function Review() {
  const stories = (await newsroom()).filter(
    (s) => s.status === "review" && !s.archived,
  );
  return (
    <>
      <PageHeader
        eyebrow="REVIEW / 03"
        title="The final editorial call."
        description="Evidence, copy, angle and rights. One package. One exact revision."
      />
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
