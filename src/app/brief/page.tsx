import Link from "next/link";
import { newsroom } from "@/server/data";
import { dataMode } from "@/server/mode";
import { selectBrief } from "@/ingestion/brief";
import { strongestSource, evidenceTier } from "@/ingestion/provenance";
import { ingestionStore } from "@/ingestion/store";
import { DateText, Status } from "@/components/ui";
import { CommandForm } from "@/components/actions";
import {
  DiscoveryForm,
  MissedStoryForm,
  Observation,
} from "@/components/discovery-actions";
import { PageHeader, LevelChip, Empty } from "@/components/ui";
async function DemoBrief() {
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

export default async function Brief() {
  if (dataMode() === "demo") return <DemoBrief />;
  const stories = selectBrief(await newsroom());
  const state = await (await ingestionStore()).state();
  const briefId = crypto.randomUUID();
  const lastSuccess = state.registry
    .map((s) => s.last_success_at)
    .filter((s): s is string => !!s)
    .sort()
    .at(-1);
  const failed = state.registry.filter((s) => s.active && s.last_error);
  return (
    <>
      <PageHeader
        eyebrow="DAILY EDITION / LIVE RESEARCH"
        title="What deserves your attention?"
        description="Recent discoveries, original evidence and explainable relevance. Every story still needs your judgment."
        action={
          <DiscoveryForm
            endpoint="/api/ingestion"
            values={{ action: "run" }}
            label="Refresh sources"
          />
        }
      />
      <div className="brief-meta">
        <strong>{stories.length} selected stories · maximum 10</strong>
        <span>
          Last successful fetch: <DateText value={lastSuccess ?? null} />
        </span>
        <Link className="text-link" href="/sources">
          Source health{failed.length ? ` · ${failed.length} failing` : ""}
        </Link>
        <Link className="text-link" href="/pilot">
          Ten-day pilot log
        </Link>
      </div>
      <p className="subtle">
        Recent = published or feed-updated within 14 days; saved stories may be
        older. At most three unpinned items per publisher. Update times do not
        establish original publication times.
      </p>
      <div className="brief-grid">
        {stories.map((s, i) => {
          const source = strongestSource(s);
          const records = state.records.filter((r) => r.story_id === s.id);
          const score = s.discovery?.scoring;
          return (
            <article className="brief-card" key={s.id}>
              <Observation
                storyId={s.id}
                kind="surfaced"
                briefId={briefId}
                rank={i + 1}
              />
              <div className="brief-card-top">
                <span className="big-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="small-cap">{s.pillar}</span>
                <Status value={s.status} />
              </div>
              <h2>
                <Link href={`/stories/${s.id}?brief=${briefId}&rank=${i + 1}`}>
                  {s.title}
                </Link>
              </h2>
              <p>{s.summary}</p>
              <div className="inline-meta">
                <span>
                  {s.published_at ? "Published" : "Feed updated"}:{" "}
                  <DateText
                    value={
                      s.published_at ?? s.discovery?.source_updated_at ?? null
                    }
                  />
                </span>
                <span>
                  {new Set(s.sources.map((x) => x.canonical_url)).size} source
                  URLs · {records.length} retained discoveries
                </span>
              </div>
              <dl>
                <dt>STRONGEST SOURCE</dt>
                <dd>
                  {source ? (
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.publisher} · {evidenceTier(source)}
                    </a>
                  ) : (
                    "Original evidence not found"
                  )}
                </dd>
                <dt>EVIDENCE CONFIDENCE</dt>
                <dd>
                  <LevelChip value={s.confidence} /> ·{" "}
                  {s.discovery?.primary_evidence_status === "retrieved"
                    ? "Primary material retrieved; claims remain unverified"
                    : "Primary evidence has not been retrieved"}
                </dd>
                <dt>WHY IT MAY MATTER · SYSTEM ASSESSMENT</dt>
                <dd>{s.why_matters}</dd>
                <dt>AUDIENCE RELEVANCE</dt>
                <dd>
                  <LevelChip value={s.audience_relevance} /> ·{" "}
                  {score?.dimensions.audience.reasons.join(". ")}
                </dd>
                <dt>LATAM RELEVANCE</dt>
                <dd>
                  <LevelChip value={s.latam_relevance} /> · {s.latam_reason}
                </dd>
                <dt>COMMERCIAL / URGENCY SIGNALS</dt>
                <dd>
                  {score?.dimensions.commercial.reasons.join(". ")}.{" "}
                  {score?.dimensions.urgency.reasons.join(". ")} (at ingestion)
                </dd>
                <dt>POTENTIAL ANGLE · SYSTEM SUGGESTION</dt>
                <dd className="angle-quote">
                  {s.discovery?.suggestions?.[0]?.text ??
                    "Choose an angle after checking the evidence."}
                </dd>
              </dl>
              <Link
                className="button secondary"
                href={`/stories/${s.id}?brief=${briefId}&rank=${i + 1}`}
              >
                Open full story
              </Link>
              <div className="discovery-actions">
                <CommandForm
                  storyId={s.id}
                  version={s.version}
                  command={{ type: "prioritize" }}
                  label={s.priority ? "Unsave" : "Save / prioritize"}
                  variant="quiet"
                />
                <CommandForm
                  storyId={s.id}
                  version={s.version}
                  command={{ type: "archive" }}
                  label="Dismiss"
                  variant="quiet"
                />
                <CommandForm
                  storyId={s.id}
                  version={s.version}
                  command={{ type: "queue_research" }}
                  label="Research next"
                  variant="quiet"
                />
              </div>
              <p className="subtle">
                Research next saves this item for investigation; it does not
                verify claims or approve an opinion.
              </p>
            </article>
          );
        })}
      </div>
      {!stories.length && (
        <Empty title="No recent live discoveries yet">
          Refresh the active sources, inspect source health, or add a story the
          system missed.
        </Empty>
      )}
      <div style={{ marginTop: 24 }}>
        <MissedStoryForm />
      </div>
    </>
  );
}
