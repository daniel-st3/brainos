"use client";
import { useState } from "react";
export function OpportunityForm({ deletion = false }: { deletion?: boolean }) {
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget,
          d = new FormData(form);
        setBusy(true);
        try {
          const r = await fetch("/api/public/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: deletion ? "data_deletion" : d.get("kind"),
              name: d.get("name"),
              email: d.get("email"),
              company: d.get("company") ?? "",
              role: d.get("role") ?? "",
              details: d.get("details"),
              consent: d.get("consent") === "on",
              website: d.get("website"),
            }),
          });
          if (!r.ok) throw Error("Revisa los campos o intenta más tarde.");
          setStatus(
            "Solicitud guardada para revisión humana. No se envió ningún email.",
          );
          form.reset();
        } catch (e) {
          setStatus(e instanceof Error ? e.message : "No se pudo guardar");
        } finally {
          setBusy(false);
        }
      }}
    >
      {!deletion && (
        <label>
          Tipo
          <select name="kind">
            <option value="consulting">Trabajar juntos / consultoría</option>
            <option value="speaking">Charla</option>
            <option value="podcast">Podcast</option>
            <option value="event">Evento</option>
            <option value="partnership">Colaboración</option>
            <option value="sponsorship">Patrocinio</option>
          </select>
        </label>
      )}
      <label>
        Nombre
        <input name="name" required maxLength={200} />
      </label>
      <label>
        Email
        <input name="email" type="email" required maxLength={254} />
      </label>
      {!deletion && (
        <>
          <label>
            Empresa
            <input name="company" maxLength={200} />
          </label>
          <label>
            Rol
            <input name="role" maxLength={200} />
          </label>
        </>
      )}
      <label>
        {deletion
          ? "Datos que deseas eliminar"
          : "Problema, caso de uso o invitación"}
        <textarea name="details" minLength={10} maxLength={4000} required />
      </label>
      <label className="honeypot" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <label>
        <input name="consent" type="checkbox" required />
        Consiento guardar estos datos para revisión humana de esta solicitud.{" "}
        <a href="/privacy">Privacidad</a>
      </label>
      <button disabled={busy}>
        {busy ? "Guardando…" : "Enviar solicitud"}
      </button>
      <p role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}
