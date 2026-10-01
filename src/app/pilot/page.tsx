import Link from "next/link";
import { newsroom } from "@/server/data";
import { ingestionStore } from "@/ingestion/store";
import { PageHeader, DateText, Empty } from "@/components/ui";
export default async function Pilot() {
  const stories = await newsroom();
  const state = await (await ingestionStore()).state();
  const rows = stories.filter((s) =>
    state.pilot.some((e) => e.story_id === s.id),
  );
  return (
    <>
      <PageHeader
        eyebrow="TEN-DAY PILOT"
        title="Was the brief useful?"
        description="A minimal observation log: what was visible, opened, saved, dismissed or turned into a draft. No audience analytics."
      />
      <p className="subtle">
        Impressions are recorded when a brief card enters the viewport, not on
        background prefetch. Missing observations are not proof that a story was
        ignored. Manual-miss entries support recall review against Daniel’s own
        browsing.
      </p>
      <div className="panel flush table-wrap">
        <table>
          <thead>
            <tr>
              <th>Story</th>
              <th>First surfaced / rank</th>
              <th>Opened</th>
              <th>Saved</th>
              <th>Dismissed</th>
              <th>Research queued</th>
              <th>Draft created</th>
              <th>Manual miss</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const events = state.pilot.filter((e) => e.story_id === s.id);
              const first = events
                .filter((e) => e.kind === "surfaced")
                .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
              const did = (kind: string) =>
                events.some((e) => e.kind === kind) ? "Yes" : "—";
              return (
                <tr key={s.id}>
                  <td>
                    <Link href={`/stories/${s.id}`}>{s.title}</Link>
                  </td>
                  <td>
                    {first ? (
                      <>
                        <DateText value={first.created_at} />
                        <br />
                        Rank {first.rank}
                      </>
                    ) : (
                      "Not observed"
                    )}
                  </td>
                  <td>{did("opened")}</td>
                  <td>{did("prioritized")}</td>
                  <td>{did("dismissed")}</td>
                  <td>{did("research_queued")}</td>
                  <td>{did("content_created")}</td>
                  <td>{did("manual_miss")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <Empty title="No pilot observations yet">
          Open the live brief or add a missed story from the inbox.
        </Empty>
      )}
    </>
  );
}
