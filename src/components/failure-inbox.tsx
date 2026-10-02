"use client";
import Link from "next/link";
import { useState } from "react";
import type { operationsCenter } from "@/operations/center";
type Center = Awaited<ReturnType<typeof operationsCenter>>;
export function FailureInbox({ center }: { center: Omit<Center, "state"> }) {
  const [message, setMessage] = useState("");
  async function retry(f: Center["failures"][number], cancel = false) {
    setMessage("Procesando…");
    let route = "/api/control",
      body: unknown;
    if (f.recovery === "control") {
      const s = await (await fetch(route)).json();
      body = {
        epoch: s.state.epoch,
        command: { action: cancel ? "job_cancel" : "job_retry", id: f.id },
      };
    } else if (f.recovery === "media") {
      route = "/api/production/studio";
      body = { action: "retry", job_id: f.id };
    } else if (f.recovery === "outbox") {
      route = "/api/activation";
      body = {
        action: "outbox_recover",
        id: f.id,
        operation: cancel
          ? "cancel"
          : f.status === "uncertain"
            ? "reconcile"
            : "retry",
      };
    } else {
      setMessage(
        "Revisa la conexión o reconciliación; un envío incierto no se repite automáticamente.",
      );
      return;
    }
    const r = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setMessage(
      r.ok
        ? "Recuperación solicitada; el próximo tick recogerá el trabajo."
        : "No se pudo recuperar este trabajo",
    );
  }
  return (
    <>
      <h2>Automatización</h2>
      {Object.entries(center.scheduler).map(([lane, s]) => (
        <p key={lane}>
          {lane}: <strong>{s.state}</strong> · esperado {s.expected_at} · último
          evento {s.last_actual?.window_at ?? "ninguno"}
        </p>
      ))}
      <p>
        Worker: {center.worker.available ? "disponible" : "BLOCKED_BY_WORKER"}
      </p>
      <h2>Failure Inbox</h2>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {center.failures.map((f) => (
        <article className="control-card" key={f.subsystem + f.id}>
          <h3>
            {f.subsystem}: {f.status}
          </h3>
          <p>{f.error}</p>
          <p>Intentos: {f.attempts}</p>
          <Link href={f.href}>Abrir revisión</Link>
          {["control", "media", "outbox"].includes(f.recovery) && (
            <button onClick={() => retry(f)}>
              {f.status === "uncertain"
                ? "Reconciliar sin reenviar"
                : "Reintentar con la misma entrada"}
            </button>
          )}
          {["control", "outbox"].includes(f.recovery) && (
            <button onClick={() => retry(f, true)}>Cancelar</button>
          )}
        </article>
      ))}
      <h2>Notificaciones</h2>
      {center.notifications.map((n) => (
        <article key={n.id} className="control-card">
          <Link href={String(n.data.href)}>{String(n.data.title)}</Link>
          <p>{n.data.read_at ? "Leída" : "Pendiente"}</p>
          {!n.data.read_at && (
            <button
              onClick={async () => {
                await fetch("/api/activation", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "acknowledge", id: n.id }),
                });
                setMessage("Notificación leída");
              }}
            >
              Marcar leída
            </button>
          )}
        </article>
      ))}
    </>
  );
}
