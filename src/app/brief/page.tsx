import Link from "next/link";
import { newsroom } from "@/server/data";
import { PageHeader, LevelChip, Empty } from "@/components/ui";
export default async function Brief() {
  const stories = (await newsroom()).filter((s) => s.priority && !s.archived);
  return (
    <>
      <PageHeader
        eyebrow="DAILY EDITION / MORNING BRIEF"
        title="What deserves your attention?"
        description="A focused reading list inside your newsroom. All items below are fictional demo scenarios."
      />
      <div className="brief-meta">
        <strong>{stories.length} priority stories</strong>
        <span>Source coverage: demo fixtures only</span>
        <span>Live ingestion not connected</span>
      </div>
      <div className="brief-grid">
        {stories.map((s, i) => (
          <article className="brief-card" key={s.id}>
            <div className="brief-card-top">
              <span className="big-number">0{i + 1}</span>
              <span className="small-cap">{s.pillar} · DEMO</span>
            </div>
            <h2>
              <Link href={`/stories/${s.id}`}>{s.title}</Link>
            </h2>
            <p>{s.summary}</p>
            <dl>
              <dt>WHY IT MAY MATTER</dt>
              <dd>{s.why_matters}</dd>
              <dt>SOURCE QUALITY</dt>
              <dd>{s.sources[0]?.reliability}</dd>
              <dt>
                LATAM RELEVANCE <LevelChip value={s.latam_relevance} />
              </dt>
              <dd>{s.latam_reason}</dd>
              <dt>AUDIENCE RELEVANCE</dt>
              <dd>
                <LevelChip value={s.audience_relevance} /> · Applied-AI builders
                and operators
              </dd>
              <dt>POTENTIAL ANGLE · SUGGESTION</dt>
              <dd className="angle-quote">
                “{s.angles.find((a) => a.created_by === "ai")?.text}”
              </dd>
            </dl>
            <Link className="button secondary" href={`/stories/${s.id}`}>
              Open story workspace
            </Link>
          </article>
        ))}
      </div>
      {!stories.length && (
        <Empty title="No priority stories yet">
          Prioritize a story from the inbox to add it to your brief.
        </Empty>
      )}
    </>
  );
}
