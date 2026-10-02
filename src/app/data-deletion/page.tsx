import { OpportunityForm } from "@/components/opportunity-form";
export default function Delete() {
  return (
    <main id="main-content" className="public-site">
      <h1>Solicitar eliminación de datos</h1>
      <p>
        Daniel verificará identidad y alcance antes de procesar tu solicitud.
      </p>
      <OpportunityForm deletion />
    </main>
  );
}
