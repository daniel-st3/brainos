import Link from "next/link";
import { ActionQueue } from "@/components/action-queue";
import { controlSnapshot, actions } from "@/control/service";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
import { ArrowUpRight, Newspaper, ShieldCheck, Clock3 } from "lucide-react";
import { newsroom } from "@/server/data";
import { PageHeader, Status, StoryTable } from "@/components/ui";
import type { StoryStatus } from "@/domain/types";
const metrics: [StoryStatus, string, string][] = [
  ["detected", "Needs verification", "/inbox?status=detected"],
  ["verified", "Research ready", "/inbox?status=verified"],
  ["researched", "Angle needed", "/inbox?status=researched"],
  ["review", "Awaiting review", "/review"],
  ["recording_needed", "Recording needed", "/production"],
  ["render_ready", "Render ready", "/production"],
  ["approved", "Approved", "/publish"],
  ["scheduled", "Scheduled", "/publish"],
];
export default async function Home() {
  const all = await newsroom(),
    stories = all.filter((s) => !s.archived),
    review = stories.filter((s) => s.status === "review");
  const queue = await controlSnapshot(
    await applicationRpc(),
    dataMode() === "demo",
  );
  return (
    <>
      <div className="mobile-actions">
        <ActionQueue
          items={actions(queue.state, queue.stories, queue.production).slice(
            0,
            8,
          )}
        />
      </div>
      <PageHeader
        eyebrow="COMMAND CENTER / 01"
        title="Your editorial desk."
        description="From a promising signal to something worth saying."
        action={
          <Link className="button dark" href="/brief">
            <Newspaper size={17} />
            Open morning brief
          </Link>
        }
      />
      <div className="metrics">
        {metrics.map(([status, label, href], i) => (
          <Link
            href={href}
            key={status}
            className={`metric ${i === 3 ? "featured" : ""}`}
          >
            <span>
              {label}
              <ArrowUpRight size={15} />
            </span>
            <strong>
              {String(
                stories.filter((s) => s.status === status).length,
              ).padStart(2, "0")}
            </strong>
            <div className="metric-line" />
          </Link>
        ))}
      </div>
      <div className="dashboard-columns">
        <section className="brief-feature">
          <div className="section-kicker">
            <span>
              <Newspaper size={17} />
              THE MORNING BRIEF
            </span>
            <span>
              {dataMode() === "demo" ? "DEMO EDITION" : "LIVE DISCOVERY"}
            </span>
          </div>
          <h2>
            Fewer tabs.
            <br />
            Better questions.
          </h2>
          <p>
            {stories.filter((s) => s.priority).length} priority stories on your
            desk. Start with the source, then decide what deserves your voice.
          </p>
          <div className="brief-spotlight">
            <span className="small-cap">LEAD STORY · AI IN PRACTICE</span>
            <Link href={stories[0] ? `/stories/${stories[0].id}` : "/inbox"}>
              {stories[0]?.title ?? "Your next story starts in the inbox."}
              <ArrowUpRight size={20} />
            </Link>
            <div className="inline-meta">
              <span>
                {dataMode() === "demo"
                  ? "Primary-source fixture"
                  : "Inspect original evidence"}
              </span>
              <span>Human verification needed</span>
            </div>
          </div>
          <Link className="text-link" href="/brief">
            Read the brief <ArrowUpRight size={15} />
          </Link>
        </section>
        <section className="panel review-highlight">
          <div className="section-heading">
            <h2>For your judgment</h2>
            <span className="count">{review.length}</span>
          </div>
          {review.length ? (
            review.map((s) => (
              <div key={s.id}>
                <Status value={s.status} />
                <h3>{s.title}</h3>
                <p>{s.why_matters}</p>
                <div className="review-facts">
                  <span>
                    <ShieldCheck size={16} />
                    {s.claims.length} traceable claim
                  </span>
                  <span>
                    <Clock3 size={16} />
                    Revision{" "}
                    {s.drafts.find((d) => d.id === s.active_draft_id)
                      ?.revision ?? "—"}{" "}
                    · ready to inspect
                  </span>
                </div>
                <Link className="button" href="/review">
                  Review the package
                </Link>
              </div>
            ))
          ) : (
            <p>No packages are waiting for review.</p>
          )}
          <div className="quiet-note">
            Approval always belongs to one exact draft revision.
          </div>
        </section>
      </div>
      <div className="command-actions">
        <ActionQueue
          items={actions(queue.state, queue.stories, queue.production).slice(
            0,
            4,
          )}
        />
      </div>
      <section className="panel flush">
        <div className="section-heading padded">
          <div>
            <span className="small-cap">THE WORK IN MOTION</span>
            <h2>On your desk</h2>
          </div>
          <Link className="text-link" href="/inbox">
            All stories <ArrowUpRight size={15} />
          </Link>
        </div>
        <StoryTable stories={stories.slice(0, 6)} />
      </section>
    </>
  );
}
