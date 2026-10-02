import { OpportunityForm } from "@/components/opportunity-form";
export default function Contact() {
  return (
    <main id="main-content" className="public-site">
      <h1>Trabajemos juntos</h1>
      <p>
        Consultoría, charlas, podcasts y colaboraciones. Daniel revisa las
        solicitudes personalmente.
      </p>
      <OpportunityForm />
      <a href="/about">Volver</a>
    </main>
  );
}
