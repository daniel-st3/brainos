import Link from "next/link";
import { ResearchAid } from "@/components/research-aid";
import { Observation } from "@/components/discovery-actions";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { newsroom } from "@/server/data";
import { Status } from "@/components/ui";
import {
  Overview,
  Sources,
  Claims,
  Research,
  Angles,
  Drafts,
  Assets,
  Activity,
  WorkflowStep,
} from "@/components/story-panels";
const tabs = [
  "overview",
  "sources",
  "claims",
  "research",
  "angles",
  "drafts",
  "assets",
  "activity",
] as const;
export default async function StoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; brief?: string; rank?: string }>;
}) {
  const { id } = await params,
    { tab = "overview", brief, rank } = await searchParams;
  const story = (await newsroom()).find((s) => s.id === id);
  if (!story) notFound();
  const views = {
    overview: Overview,
    sources: Sources,
    claims: Claims,
    research: Research,
    angles: Angles,
    drafts: Drafts,
    assets: Assets,
    activity: Activity,
  };
  const Panel = views[tab as keyof typeof views] ?? Overview;
  return (
    <>
      {!story.is_demo && (
        <Observation
          storyId={id}
          kind="opened"
          briefId={brief && /^[0-9a-f-]{36}$/i.test(brief) ? brief : null}
          rank={
            rank && Number(rank) > 0 && Number(rank) <= 100
              ? Number(rank)
              : null
          }
        />
      )}
      {story.discovery?.needs_review && (
        <div className="notice">
          Source material changed. Review the retained new excerpt and reconfirm
          research; prior approval is no longer current.
        </div>
      )}
      <Link className="back-link" href="/inbox">
        <ArrowLeft size={15} />
        Story inbox
      </Link>
      <div className="story-heading">
        <div className="inline-meta">
          <span className="eyebrow">
            {story.pillar} / {story.story_type}
          </span>
          {story.is_demo && <span className="demo-label">DEMO SCENARIO</span>}
        </div>
        <h1>{story.title}</h1>
        <div className="inline-meta">
          <Status value={story.status} />
          <span>{story.sources.length} sources</span>
          <span>{story.claims.length} claim</span>
          <span>{story.primary_language.toUpperCase()} primary</span>
        </div>
      </div>
      <WorkflowStep story={story} />
      <nav className="tabs" aria-label="Story sections">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`/stories/${id}?tab=${t}`}
            className={t === tab ? "selected" : ""}
            aria-current={t === tab ? "page" : undefined}
          >
            {t}
            {t === "drafts" && <span>{story.drafts.length}</span>}
            {t === "sources" && <span>{story.sources.length}</span>}
          </Link>
        ))}
      </nav>
      <div className="workspace-content">
        <Panel story={story} />
        {tab === "research" && !story.is_demo && (
          <ResearchAid storyId={story.id} />
        )}
      </div>
    </>
  );
}
