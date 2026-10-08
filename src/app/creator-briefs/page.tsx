import { editor } from "@/server/auth";
import { applicationRpc } from "@/ingestion/store";
import { PageHeader, Empty } from "@/components/ui";
import type { CreatorSnapshot } from "@/creator/discovery";
export const dynamic = "force-dynamic";
export default async function CreatorBriefs() {
  await editor();
  const runs = (await (
    await applicationRpc()
  )("read_creator_runs")) as {
    slot: string;
    snapshot: CreatorSnapshot | null;
  }[];
  const snapshot = runs.find((r) => r.snapshot)?.snapshot;
  return (
    <>
      <PageHeader
        eyebrow="EXPERIMENTO · STAGING"
        title="Story briefs"
        description="Descubrimiento para creadores, separado del piloto. No son publicaciones listas: falta verificar afirmaciones, derechos, copy en español y medios finales."
      />
      {!snapshot ? (
        <Empty title="Aún no hay un brief">
          El próximo recorrido guardará sus fuentes aquí. Ningún contenido se
          publicará automáticamente.
        </Empty>
      ) : (
        <>
          <p>
            Actualizado:{" "}
            {new Date(snapshot.captured_at).toLocaleString("es-CO", {
              timeZone: "America/Bogota",
            })}{" "}
            · Bogotá
          </p>
          <p>
            {snapshot.sources.filter((s) => s.status === "HEALTHY").length}/
            {snapshot.sources.length} fuentes respondieron. El puntaje usa
            señales explícitas de títulos y feeds; no mide calidad creativa.
          </p>
          {snapshot.briefs
            .filter((b) => snapshot.shortlist.includes(b.url))
            .map((b) => (
              <article className="panel" key={b.url}>
                <p className="eyebrow">
                  STORY BRIEF · {b.source} · {b.score}/100 experimental
                </p>
                <h2>
                  <a href={b.url} target="_blank" rel="noopener noreferrer">
                    {b.title}
                  </a>
                </h2>
                <p>{b.excerpt}</p>
                <p>
                  Fuente{" "}
                  {b.primary_source
                    ? "primaria"
                    : "periodística — corroboración primaria pendiente"}
                  . {b.media_candidates.length} referencias visuales; derechos
                  sin resolver.
                </p>
                <details>
                  <summary>Señales y pendientes</summary>
                  <pre
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {JSON.stringify(
                      { dimensions: b.dimensions, blockers: b.blockers },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </article>
            ))}
          {!snapshot.shortlist.length && (
            <Empty title="Sin selección en este recorrido">
              No se fuerza una cuota. Consulta las fuentes y sus resultados.
            </Empty>
          )}
          <details>
            <summary>Fuentes de este recorrido</summary>
            <ul>
              {snapshot.sources.map((s) => (
                <li key={s.id}>
                  {s.id}:{" "}
                  {s.status === "HEALTHY"
                    ? `${s.count} entradas`
                    : "No disponible; se reintentará en el próximo recorrido"}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </>
  );
}
