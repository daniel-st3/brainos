import { applicationRpc } from "@/ingestion/store";
import { publicRecords } from "@/control/public";
import { NewsletterSignup } from "@/components/newsletter-signup";
import Link from "next/link";
import { EditorialMotion } from "@/components/design/motion";
export async function generateMetadata() {
  const origin = process.env.CONTENT_OS_ORIGIN;
  const profile = (await publicRecords(await applicationRpc())).find(
    (record) => record.kind === "profile",
  );
  const title = profile?.title ?? "Ideas que se pueden poner a prueba.";
  const description =
    profile?.description ?? "Construir, probar y mostrar AI aplicada.";
  return {
    title,
    description,
    alternates: { canonical: origin ? `${origin}/about` : undefined },
    openGraph: {
      title,
      images: [
        { url: `${origin ?? ""}/api/public/share`, width: 1200, height: 630 },
      ],
    },
    twitter: {
      card: "summary_large_image",
      images: [`${origin ?? ""}/api/public/share`],
    },
  };
}
export const dynamic = "force-dynamic";
export default async function About() {
  const records = await publicRecords(await applicationRpc()),
    profile = records.find((r) => r.kind === "profile");
  return (
    <div className="public-site public-editorial">
      <EditorialMotion scope=".public-editorial" />
      <header>
        <span className="eyebrow">DVNI / DANIEL RODRIGUEZ / APPLIED AI</span>
        <h1>{profile?.title ?? "Ideas que se pueden poner a prueba."}</h1>
        <div className="public-intro">
          <p>
            {profile?.description ??
              "Un espacio para construir, probar y mostrar cómo funciona la inteligencia artificial en la práctica."}
          </p>
          <div>
            <span className="small-cap">CONSTRUIR · PROBAR · EXPLICAR</span>
            <br />
            <Link className="text-link" href="/contact">
              Consultoría & charlas ↗
            </Link>
          </div>
        </div>
        {profile?.body && <p className="preserve-lines">{profile.body}</p>}
      </header>
      {["build", "content"].map((kind) => (
        <section key={kind} data-reveal>
          <div className="public-section-heading">
            <span>{kind === "build" ? "01 / BUILD" : "02 / READ"}</span>
            <h2>
              {kind === "build"
                ? "Proyectos y pruebas"
                : "Contenido seleccionado"}
            </h2>
          </div>
          {records.filter((r) => r.kind === kind).length === 0 ? (
            <p>
              En preparación. Solo se muestran piezas aprobadas para este sitio.
            </p>
          ) : (
            records
              .filter((r) => r.kind === kind)
              .map((r) => (
                <article key={r.id}>
                  <h3>{r.title}</h3>
                  <p>{r.description}</p>
                  <p className="preserve-lines">{r.body}</p>
                  {r.url && (
                    <a href={r.url} rel="noopener noreferrer">
                      Ver proyecto
                    </a>
                  )}
                </article>
              ))
          )}
        </section>
      ))}
      <section id="newsletter" data-reveal>
        <div className="public-section-heading">
          <span>03 / LETTER</span>
          <h2>Newsletter</h2>
        </div>
        <span className="small-cap">UNA IDEA QUE VALE LA PENA</span>
        <p>
          Ideas, fuentes y aprendizajes de pruebas reales. Registra tu interés
          para cuando esté lista.
        </p>
        <NewsletterSignup />
      </section>
      {records.filter((r) => r.kind === "link").length > 0 && (
        <nav aria-label="Public links">
          {records
            .filter((r) => r.kind === "link")
            .map((r) => (
              <a key={r.id} href={r.url!} rel="noopener noreferrer">
                {r.title}
              </a>
            ))}
        </nav>
      )}
      <footer>
        <Link href="/contact">Trabajemos juntos</Link> ·{" "}
        <Link href="/privacy">Privacidad</Link> ·{" "}
        <Link href="/terms">Condiciones</Link> ·{" "}
        <Link href="/content">Contenido publicado</Link>
        <p>
          Privacidad: guardamos el email, consentimiento y origen. No vendemos
          datos ni enviamos marketing automático. El registro es opcional.
        </p>
      </footer>
    </div>
  );
}
