import Link from "next/link";
import { publicRecords } from "@/control/public";
import { applicationRpc } from "@/ingestion/store";
export default async function Content() {
  const rows = (await publicRecords(await applicationRpc())).filter(
    (r) => r.kind === "content",
  );
  return (
    <section className="public-site">
      <h1>Contenido publicado</h1>
      {rows.length ? (
        rows.map((r) => (
          <article key={r.id}>
            <h2>{r.title}</h2>
            <p>{r.description}</p>
            {r.url && (
              <a href={r.url} rel="noopener noreferrer">
                Ver publicación
              </a>
            )}
          </article>
        ))
      ) : (
        <p>No hay publicaciones aprobadas para este sitio todavía.</p>
      )}
      <Link href="/about">Volver</Link>
    </section>
  );
}
