import Link from "next/link";
import { Unplug } from "lucide-react";
import { newsroom } from "@/server/data";
import { PageHeader, DateText, Empty } from "@/components/ui";
import { CommandForm } from "@/components/actions";
import { platformLabels } from "@/domain/types";
export default async function Publish() {
  const stories = await newsroom();
  const entries = stories.flatMap((s) =>
    s.publications
      .filter((p) => p.status !== "cancelled")
      .map((p) => ({ s, p, d: s.drafts.find((d) => d.id === p.draft_id)! })),
  );
  return (
    <>
      <PageHeader
        eyebrow="PUBLISH / 05"
        title="Ready when you are."
        description="Approved revisions and internal schedules. Nothing leaves this newsroom automatically."
      />
      <div className="notice">
        <Unplug size={20} />
        <div>
          <strong>External integrations are not connected.</strong>
          <p>
            Scheduled times are planning records. To publish, use the platform
            yourself and record the resulting URL here.
          </p>
        </div>
      </div>
      <div className="results-label">{entries.length} APPROVED PACKAGES</div>
      <div className="publish-list">
        {entries.map(({ s, p, d }) => (
          <article className="panel publish-card" key={p.id}>
            <div className="section-heading">
              <span className="small-cap">
                {platformLabels[p.platform]} / APPROVED v{d.revision}
              </span>
              <span
                className={`rights rights-${p.status === "published_manual" ? "cleared" : "unknown"}`}
              >
                {p.status.replaceAll("_", " ")}
              </span>
            </div>
            <h2>
              <Link href={`/stories/${s.id}?tab=drafts`}>{s.title}</Link>
            </h2>
            <div className="publish-details">
              <div>
                <span className="small-cap">DESTINATION</span>
                <p>{p.destination}</p>
              </div>
              <div>
                <span className="small-cap">SCHEDULED · BOGOTÁ</span>
                <p>
                  <DateText value={p.scheduled_at} />
                </p>
              </div>
              <div>
                <span className="small-cap">APPROVAL</span>
                <p>
                  {d.approved_by}
                  <br />
                  <DateText value={d.approved_at} />
                </p>
              </div>
              <div>
                <span className="small-cap">DELIVERY</span>
                <p>
                  {p.status === "published_manual"
                    ? "Recorded manually"
                    : "Integration required"}
                </p>
              </div>
            </div>
            {p.status === "ready_to_schedule" && (
              <>
                {!s.production_completed && (
                  <p className="form-error">
                    Complete{" "}
                    <Link href="/production">production preparation</Link>{" "}
                    before scheduling.
                  </p>
                )}
                <CommandForm
                  key={s.version}
                  storyId={s.id}
                  version={s.version}
                  command={{ type: "schedule", draftId: d.id }}
                  label="Save internal schedule"
                >
                  <div className="form-columns">
                    <label>
                      Destination
                      <input
                        name="destination"
                        placeholder="Daniel · Instagram"
                        required
                      />
                    </label>
                    <label>
                      Scheduled time · Bogotá (UTC−05:00)
                      <input
                        name="scheduledAt"
                        type="datetime-local"
                        required
                      />
                    </label>
                  </div>
                </CommandForm>
              </>
            )}
            {p.status === "scheduled_internal" && (
              <details>
                <summary>Record a manual publication</summary>
                <CommandForm
                  storyId={s.id}
                  version={s.version}
                  command={{ type: "mark_published", publicationId: p.id }}
                  label="Record as published manually"
                >
                  <label>
                    Live post URL
                    <input
                      name="url"
                      type="url"
                      required
                      placeholder="https://…"
                    />
                  </label>
                  <p className="subtle">
                    This records your confirmation; it does not send or verify a
                    post.
                  </p>
                </CommandForm>
              </details>
            )}
            {p.published_url && (
              <a
                className="text-link"
                href={p.published_url}
                target="_blank"
                rel="noreferrer"
              >
                Open recorded post
              </a>
            )}
          </article>
        ))}
      </div>
      {!entries.length && (
        <Empty title="Nothing approved for publishing yet">
          Approve an exact draft revision from Review to create a queue entry.
        </Empty>
      )}
    </>
  );
}
