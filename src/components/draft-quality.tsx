import { applicationRpc } from "@/ingestion/store";
import { readControl, activeBrand } from "@/control/service";
import { quality, type QualityIssue } from "@/control/model";
import type { Story } from "@/domain/types";
export async function DraftQuality({ story }: { story: Story }) {
  const d = story.drafts.find((d) => d.id === story.active_draft_id);
  if (!d) return null;
  const state = await readControl(await applicationRpc(), story.is_demo),
    run = state.entities.find(
      (e) => e.kind === "quality" && e.draft_id === d.id,
    );
  const issues = run
    ? (run.data.issues as QualityIssue[])
    : quality(`${d.hook}\n${d.body}\n${d.cta}`, activeBrand(state)?.data.rules);
  return (
    <section className="panel">
      <h2>Voice quality review</h2>
      <p>
        Exact draft r{d.revision} · deterministic warnings · approved copy is
        never rewritten.
      </p>
      {issues.length === 0 ? (
        <p>No configured pattern warnings.</p>
      ) : (
        issues.map((issue, i) => (
          <p key={i}>
            {issue.severity}: “{issue.excerpt}” — {issue.remediation}
          </p>
        ))
      )}
    </section>
  );
}
