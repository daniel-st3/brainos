import Link from "next/link";
import { ArrowUpRight, FileText } from "lucide-react";
import {
  labels,
  type Story,
  type StoryStatus,
  type Level,
} from "@/domain/types";
import type { ReactNode } from "react";
export function Status({ value }: { value: StoryStatus }) {
  return (
    <span className={`status status-${value}`}>
      <i />
      {labels[value]}
    </span>
  );
}
export function LevelChip({ value }: { value: Level }) {
  return <span className={`level level-${value}`}>{value}</span>;
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <FileText size={26} />
      <h3>{title}</h3>
      <p>
        {children ??
          "Stories will appear here as they move through your editorial workflow."}
      </p>
      <Link href="/inbox" className="text-link">
        Browse the inbox <ArrowUpRight size={14} />
      </Link>
    </div>
  );
}
export function DateText({ value }: { value: string | null }) {
  return (
    <>
      {value
        ? new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/Bogota",
          }).format(new Date(value))
        : "Not provided"}
    </>
  );
}
export function StoryLink({ story }: { story: Story }) {
  return (
    <Link className="story-title" href={`/stories/${story.id}`}>
      {story.title}
      <ArrowUpRight size={16} />
    </Link>
  );
}
export function StoryTable({ stories }: { stories: Story[] }) {
  if (!stories.length) return <Empty title="No stories in this view" />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>STORY / PILLAR</th>
            <th>STATUS</th>
            <th>SOURCE</th>
            <th>CONFIDENCE</th>
            <th>LATAM</th>
          </tr>
        </thead>
        <tbody>
          {stories.map((s) => (
            <tr key={s.id}>
              <td>
                <StoryLink story={s} />
                <div className="table-sub">
                  {s.priority && (
                    <span className="priority-mark">PRIORITY</span>
                  )}
                  {s.pillar}
                  <span>·</span>
                  {s.story_type}
                </div>
              </td>
              <td>
                <Status value={s.status} />
              </td>
              <td>
                <span className="publisher">
                  {s.sources[0]?.publisher ?? "No source"}
                </span>
                <small>{s.sources[0]?.tier ?? "Unclassified"} source</small>
              </td>
              <td>
                <LevelChip value={s.confidence} />
              </td>
              <td>
                <LevelChip value={s.latam_relevance} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
