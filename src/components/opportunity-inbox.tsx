"use client";
import { useState } from "react";
export function OpportunityInbox({
  initial,
}: {
  initial: {
    id: string;
    name: string;
    email: string;
    details: string;
    kind: string;
    status: string;
  }[];
}) {
  const [rows, setRows] = useState(initial),
    [message, setMessage] = useState("");
  async function send(c: unknown) {
    const r = await fetch("/api/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    });
    if (!r.ok) {
      setMessage("No se pudo guardar");
      return;
    }
    setMessage("Guardado");
    const v = await (await fetch("/api/opportunities")).json();
    setRows(v.opportunities);
  }
  return (
    <section>
      <h2>Solicitudes privadas</h2>
      <p role="status">{message}</p>
      <a href="/api/opportunities?export=subscribers">
        Exportar suscriptores con consentimiento (privado)
      </a>
      {rows.map((r) => (
        <article className="control-card" key={r.id}>
          <h3>
            {r.name} · {r.kind}
          </h3>
          <p>{r.email}</p>
          <p>{r.details}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send({
                action: "review",
                id: r.id,
                status: new FormData(e.currentTarget).get("status"),
              });
            }}
          >
            <label>
              Estado
              <select name="status" defaultValue={r.status}>
                <option value="new" disabled>
                  NEW
                </option>
                {[
                  "reviewed",
                  "qualified",
                  "not_a_fit",
                  "contacted",
                  "closed",
                ].map((s) => (
                  <option key={s} value={s}>
                    {s.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <button>Guardar revisión</button>
          </form>
        </article>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          if (d.get("confirmed") === "on")
            void send({
              action: "delete_personal_data",
              email: d.get("email"),
              confirmed: true,
            });
        }}
      >
        <h3>Eliminar datos personales locales</h3>
        <label>
          Email verificado
          <input name="email" type="email" required />
        </label>
        <label>
          <input name="confirmed" type="checkbox" required />
          Verifiqué la identidad y autorizo eliminar estos datos locales. La
          revocación en proveedores se revisa por separado.
        </label>
        <button>Eliminar datos personales</button>
      </form>
    </section>
  );
}
