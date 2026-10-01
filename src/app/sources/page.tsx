import Link from "next/link";
import { newsroom } from "@/server/data";
import { dataMode } from "@/server/mode";
import { ingestionStore } from "@/ingestion/store";
import { sourceDefinitions } from "@/ingestion/registry";
import { PageHeader, DateText } from "@/components/ui";
import { DiscoveryForm } from "@/components/discovery-actions";
export default async function SourcesPage() {
  await newsroom();
  if (dataMode() === "demo")
    return (
      <>
        <PageHeader
          eyebrow="SOURCE REGISTRY"
          title="Live sources are separate."
          description="Run with CONTENT_OS_DATA_MODE=live to enable discovery. The demo remains deterministic."
        />
        <Link href="/brief">Back to demo brief</Link>
      </>
    );
  const store = await ingestionStore();
  await store.ensureSources(sourceDefinitions);
  const state = await store.state();
  return (
    <>
      <PageHeader
        eyebrow="RESEARCH OPERATIONS"
        title="Sources and ingestion."
        description="Registered public feeds, observed fetch health and exact run outcomes."
        action={
          <DiscoveryForm
            endpoint="/api/ingestion"
            values={{ action: "run" }}
            label="Fetch active sources"
          />
        }
      />
      <div className="notice">
        A successful fetch does not verify a story. Disabled sources are
        candidates, not claims of working integrations.
      </div>
      <div className="panel-stack">
        {state.registry
          .filter((s) => s.definition.adapter !== "manual")
          .map((s) => (
            <section className="panel" key={s.id}>
              <div className="section-heading">
                <h2>{s.definition.name}</h2>
                <span className="tag">
                  Tier {s.definition.tier} · {s.active ? "ACTIVE" : "INACTIVE"}
                </span>
              </div>
              <a
                className="text-link"
                href={s.definition.endpoint}
                target="_blank"
                rel="noreferrer"
              >
                {s.definition.endpoint}
              </a>
              <p className="subtle">
                {s.definition.adapter} · {s.definition.type} ·{" "}
                {s.definition.topics.join(", ")}
              </p>
              <p>{s.definition.reliability}</p>
              <div className="inline-meta">
                <span>
                  Last success: <DateText value={s.last_success_at} />
                </span>
                <span>
                  Last attempt: <DateText value={s.last_attempt_at} />
                </span>
              </div>
              {s.last_error && <p className="form-error">{s.last_error}</p>}
              <div className="discovery-actions">
                <DiscoveryForm
                  endpoint="/api/ingestion"
                  values={{ action: "run", sourceId: s.id }}
                  label="Test this source"
                />
                <DiscoveryForm
                  endpoint="/api/ingestion"
                  values={{
                    action: "toggle",
                    sourceId: s.id,
                    active: !s.active,
                  }}
                  label={s.active ? "Disable source" : "Enable source"}
                />
              </div>
            </section>
          ))}
      </div>
      <section className="panel flush" style={{ marginTop: 24 }}>
        <div className="section-heading padded">
          <h2>Recent ingestion runs</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source / started</th>
                <th>Outcome</th>
                <th>Fetched</th>
                <th>New</th>
                <th>Deduplicated</th>
                <th>Updated / skipped</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {state.runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.source_id}
                    <br />
                    <DateText value={r.started_at} />
                  </td>
                  <td>{r.status}</td>
                  <td>{r.items_fetched}</td>
                  <td>{r.new_stories}</td>
                  <td>{r.deduplicated_items}</td>
                  <td>
                    {r.updated_items} / {r.skipped_items}
                  </td>
                  <td>{r.errors.join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
