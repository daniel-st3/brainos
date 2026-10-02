import { editor } from "@/server/auth";
import { createDemoStories } from "@/domain/seed";
export default async function RecordingDemo() {
  await editor();
  const stories = createDemoStories(),
    story = stories.find((s) => s.drafts.length)!;
  const draft = story.drafts[0];
  return (
    <main id="main-content" className="public-site">
      <header>
        <span className="eyebrow">DEMO / FICTIONAL FIXTURES</span>
        <h1>BrainOS · demo para grabación</h1>
        <p>
          Estas escenas usan datos ficticios reproducibles. No muestran
          resultados live, cuentas, notas privadas, emails, IDs, carpetas ni
          secretos. Ninguna acción escribe al sistema.
        </p>
      </header>
      <nav aria-label="Demo scenes">
        {[
          "brief",
          "evidence",
          "angle",
          "script",
          "production",
          "distribution",
        ].map((s) => (
          <a key={s} href={`#${s}`}>
            {s} ·{" "}
          </a>
        ))}
      </nav>
      <section id="brief">
        <h2>Morning Brief — fixture</h2>
        {stories.slice(0, 3).map((s, n) => (
          <article key={n}>
            <h3>{s.title}</h3>
            <p>{s.summary}</p>
          </article>
        ))}
      </section>
      <section id="evidence">
        <h2>Evidencia / claims — fixture</h2>
        <h3>{story.title}</h3>
        {story.claims.slice(0, 3).map((c, n) => (
          <p key={n}>
            {c.text} · {c.verification_status}
          </p>
        ))}
        <p>Las referencias internas se ocultan en esta presentación.</p>
      </section>
      <section id="angle">
        <h2>Propuesta de ángulo → decisión humana</h2>
        {story.angles.slice(0, 2).map((a, n) => (
          <article key={n}>
            <h3>{a.text}</h3>
            <p>{a.approval_state} (fixture, no aprobación real)</p>
          </article>
        ))}
      </section>
      <section id="script">
        <h2>Guion con revisión exacta — fixture</h2>
        <p>
          Revisión {draft.revision} · {draft.status}
        </p>
        <h3>{draft.hook}</h3>
        <p className="preserve-lines">{draft.body}</p>
        <p>{draft.cta}</p>
      </section>
      <section id="production">
        <h2>Drive / Production / worker</h2>
        <p>
          Mapa del flujo; no es un resultado observado: conexión personal →
          grabación → transcripción local → plan de cortes → subtítulos → assets
          con derechos → render → revisión humana.
        </p>
        <p>
          Daniel permanece en cámara. Cada paquete requiere una revisión
          aprobada y exacta.
        </p>
      </section>
      <section id="distribution">
        <h2>Paquete / analytics</h2>
        <p>
          Mapa del flujo: aprobación final → outbox inmutable → proveedor →
          publicación → snapshots +24 / +72 / +168 horas → revisión → sugerencia
          de aprendizaje pendiente de Daniel.
        </p>
        <p>
          El simulador se prueba por los mismos servicios del outbox. Ningún
          post o métrica sintética se presenta como un resultado real.
        </p>
      </section>
    </main>
  );
}
