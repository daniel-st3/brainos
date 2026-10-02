import { applicationRpc } from "@/ingestion/store";
import { publicRecords } from "@/control/public";
import { NewsletterSignup } from "@/components/newsletter-signup";
import Link from "next/link";
export async function generateMetadata() {
  const origin = process.env.CONTENT_OS_ORIGIN;
  return {
    title: "Daniel / AI aplicada",
    description: "Construir, probar y mostrar AI aplicada.",
    alternates: { canonical: origin ? `${origin}/about` : undefined },
    openGraph: {
      title: "Daniel / AI aplicada",
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
    <div className="public-site">
      <header>
        <span className="eyebrow">DANIEL RODRIGUEZ / AI APLICADA</span>
        <h1>{profile?.title ?? "Ideas que se pueden poner a prueba."}</h1>
        <p>
          {profile?.description ??
            "Un espacio para construir, probar y mostrar cómo funciona la inteligencia artificial en la práctica."}
        </p>
        {profile?.body && <p className="preserve-lines">{profile.body}</p>}
      </header>
      {["build", "content"].map((kind) => (
        <section key={kind}>
          <h2>
            {kind === "build"
              ? "Proyectos y pruebas"
              : "Contenido seleccionado"}
          </h2>
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
      <section>
        <h2>Newsletter</h2>
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
        Privacidad: guardamos el email, consentimiento y origen. No vendemos
        datos ni enviamos marketing automático. El registro es opcional.
      </footer>
    </div>
  );
}
