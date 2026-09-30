import { newsroom } from "@/server/data";
import {
  PageHeader,
  StoryLink,
  Status,
  LevelChip,
  DateText,
  Empty,
} from "@/components/ui";
import { CommandForm } from "@/components/actions";
import { statuses, labels } from "@/domain/types";
export default async function Inbox({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams,
    all = await newsroom(),
    stories = all.filter(
      (s) =>
        (q.archived === "true" ? s.archived : !s.archived) &&
        (!q.status || s.status === q.status) &&
        (!q.pillar || s.pillar === q.pillar) &&
        (!q.q ||
          `${s.title} ${s.summary}`
            .toLowerCase()
            .includes(q.q.toLowerCase())) &&
        (!q.priority || s.priority),
    );
  return (
    <>
      <PageHeader
        eyebrow="STORY INBOX / 02"
        title="Signals worth a closer look."
        description="Find the source. Check the claim. Choose what matters."
      />
      <form className="filter-bar" method="get">
        <label className="search-label">
          <span>Search stories</span>
          <input name="q" placeholder="Search the inbox…" defaultValue={q.q} />
        </label>
        <label>
          <span>Status</span>
          <select name="status" defaultValue={q.status ?? ""}>
            <option value="">All stages</option>
            {statuses.map((s) => (
              <option value={s} key={s}>
                {labels[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Pillar</span>
          <select name="pillar" defaultValue={q.pillar ?? ""}>
            <option value="">All pillars</option>
            {[...new Set(all.map((s) => s.pillar))].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            name="priority"
            type="checkbox"
            value="true"
            defaultChecked={!!q.priority}
          />
          Priority
        </label>
        <label className="check">
          <input
            name="archived"
            type="checkbox"
            value="true"
            defaultChecked={q.archived === "true"}
          />
          Archived
        </label>
        <button className="button dark">Filter</button>
      </form>
      <div className="results-label">
        {stories.length} STORIES{" "}
        <span>Original timestamps preserved · display in Bogotá time</span>
      </div>
      <div className="inbox-list">
        {stories.map((s, i) => (
          <article className="inbox-card" key={s.id}>
            <span className="story-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="inbox-body">
              <div className="inline-meta">
                <span className="small-cap">{s.pillar}</span>
                <span className="demo-label">DEMO</span>
                {s.priority && <span className="priority-mark">PRIORITY</span>}
              </div>
              <StoryLink story={s} />
              <p>{s.summary}</p>
              <div className="inline-meta">
                <strong>{s.sources[0]?.publisher}</strong>
                <span>{s.sources[0]?.tier} source</span>
                <span>
                  Published: <DateText value={s.published_at} />
                </span>
              </div>
              <div className="inbox-signals">
                <span>
                  Confidence <LevelChip value={s.confidence} />
                </span>
                <span>
                  Audience <LevelChip value={s.audience_relevance} />
                </span>
                <span>
                  LATAM <LevelChip value={s.latam_relevance} />
                </span>
                <span>
                  Urgency <LevelChip value={s.urgency} />
                </span>
              </div>
            </div>
            <div className="inbox-actions">
              <Status value={s.status} />
              <CommandForm
                storyId={s.id}
                version={s.version}
                command={{ type: "prioritize" }}
                label={s.priority ? "Unpin priority" : "Prioritize"}
                variant="quiet"
              />
              <CommandForm
                storyId={s.id}
                version={s.version}
                command={{ type: "archive" }}
                label={s.archived ? "Restore story" : "Archive"}
                variant="quiet"
              />
            </div>
          </article>
        ))}
        {!stories.length && <Empty title="No stories match these filters" />}
      </div>
    </>
  );
}
