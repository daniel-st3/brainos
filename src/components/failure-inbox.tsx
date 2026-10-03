"use client";
import Link from "next/link";
import { useState } from "react";
import { StatusChip } from "./design/primitives";
import { humanStatus } from "./design/status";
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
      <div className="health-rows">
        {Object.entries(center.scheduler).map(([lane, s]) => (
          <div className="health-row" key={lane}>
            <div>
              <h3>
                {lane === "daily" || lane === "discovery"
                  ? "Daily discovery"
                  : lane === "hourly" || lane === "operations"
                    ? "Hourly operations"
                    : humanStatus(lane)}
              </h3>
              <p>
                Esperado {s.expected_at}
                <br />
                Último evento {s.last_actual?.window_at ?? "ninguno"}
              </p>
            </div>
            <StatusChip
              tone={
                ["missed", "failed", "stale"].includes(s.state)
                  ? "warning"
                  : "positive"
              }
            >
              {humanStatus(s.state)}
            </StatusChip>
          </div>
        ))}
        <div className="health-row">
          <div>
            <h3>Local media worker</h3>
            <p>Heartbeat · heavy processing stays on your Mac</p>
          </div>
          <StatusChip tone={center.worker.available ? "positive" : "warning"}>
            {center.worker.available ? "Available" : "Worker unavailable"}
          </StatusChip>
        </div>
        <div className="health-row">
          <div>
            <h3>Drive & provider connections</h3>
            <p>
              Account authentication and publishing capabilities are checked
              separately.
            </p>
          </div>
          <Link className="text-link" href="/activation">
            Inspect accounts →
          </Link>
        </div>
      </div>
      <h2>Failure Inbox</h2>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {!center.failures.length && (
        <p className="notice">No operations need recovery.</p>
      )}
      {center.failures.map((f) => (
        <article className="control-card" key={f.subsystem + f.id}>
          <h3>
            {humanStatus(f.subsystem)}: {humanStatus(f.status)}
          </h3>
          <p>{f.error}</p>
          <p>Intentos: {f.attempts}</p>
          <Link href={f.href}>Abrir revisión</Link>
          {["control", "outbox"].includes(f.recovery) && (
            <button
              onClick={async () => {
                const r = await fetch("/api/activation", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(
                    f.recovery === "outbox"
                      ? {
                          action: "outbox_recover",
                          id: f.id,
                          operation: "resolved",
                        }
                      : { action: "job_resolve", id: f.id },
                  ),
                });
                setMessage(
                  r.ok
                    ? "Resolución registrada; historial conservado"
                    : "No se pudo resolver",
                );
              }}
            >
              Marcar resuelto
            </button>
          )}
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
