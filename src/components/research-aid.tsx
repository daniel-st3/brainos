import Link from "next/link";
import { applicationRpc } from "@/ingestion/store";
import type { researchPacket } from "@/operations/research";
export async function ResearchAid({ storyId }: { storyId: string }) {
  const result = (await (
    await applicationRpc()
  )("read_operations")) as {
    generations: {
      id: string;
      story_id: string;
      kind: string;
      provider: string;
      generated_at: string;
      output: ReturnType<typeof researchPacket>;
    }[];
  };
  const record = result.generations.find(
    (g) => g.story_id === storyId && g.kind === "enrich",
  );
  if (!record) return null;
  return (
    <section className="panel">
      <h2>Generated research aid</h2>
      <p>{record.output.label}</p>
      <p>{record.output.summary}</p>
      <p className="muted">
        {record.provider} · {record.generated_at} ·{" "}
        {record.output.evidence_status}
      </p>
      <ul>
        {record.output.candidate_claims.map((c, i) => (
          <li key={i}>
            {c.text}{" "}
            <Link href={c.url} target="_blank" rel="noreferrer">
              Feed evidence
            </Link>{" "}
            · unverified
          </li>
        ))}
      </ul>
      <p>
        This does not replace Daniel’s research confirmation or establish an
        opinion.
      </p>
    </section>
  );
}
