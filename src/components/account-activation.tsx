"use client";
import { useState } from "react";
import type { activationState } from "@/providers/activation";
type State = Awaited<ReturnType<typeof activationState>>;
export function AccountActivation({ initial }: { initial: State }) {
  const [state, setState] = useState<State | null>(initial),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [writeConfirmations, setWriteConfirmations] = useState<
      Record<string, boolean>
    >({});
  const load = async () => {
    const r = await fetch("/api/activation"),
      v = await r.json();
    if (!r.ok) throw Error(v.error);
    setState(v);
    setWriteConfirmations({});
  };
  async function save(c: unknown) {
    setBusy(true);
    try {
      const r = await fetch("/api/activation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(c),
        }),
        v = await r.json();
      if (!r.ok) throw Error(v.error);
      if (v.url) {
        window.location.assign(v.url);
        return;
      }
      setMessage("Guardado.");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }
  function submit(
    e: React.FormEvent<HTMLFormElement>,
    fn: (d: FormData) => unknown,
  ) {
    e.preventDefault();
    void save(fn(new FormData(e.currentTarget)));
  }
  if (!state)
    return (
      <main id="main-content" className="page">
        <h1>Account Activation</h1>
        <p role="status">{message || "Cargando…"}</p>
      </main>
    );
  return (
    <main id="main-content" className="page">
      <header className="page-header">
        <h1>Account Activation</h1>
        <p>
          Crea la cuenta, registra el handle, conecta y verifica. Después
          autoriza los envíos por cuenta; cada paquete conserva su aprobación
          final.
        </p>
      </header>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <section className="panel">
        <h2>Conexión gratuita: Instagram, TikTok y X</h2>
        <p>
          Crea tú la cuenta gratuita de Buffer y conecta tus tres canales allí.
          Después pega una sola API key aquí y selecciona las cuentas
          detectadas. No necesitas crear aplicaciones de desarrollador para
          estos tres canales.
        </p>
        <p>
          Plan gratuito: hasta 3 canales y 10 publicaciones en cola por canal.
          BrainOS conserva la aprobación humana; conectar no publica nada.
        </p>
        <a href="https://buffer.com" target="_blank" rel="noopener noreferrer">
          Crear / abrir Buffer ↗
        </a>
        {" · "}
        <a
          href="https://developers.buffer.com/guides/getting-started.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          Obtener API key oficial ↗
        </a>
        <form
          onSubmit={(e) => {
            const form = e.currentTarget;
            submit(e, (d) => ({ action: "buffer_key", key: d.get("key") }));
            form.reset();
          }}
        >
          <label>
            API key privada de Buffer
            <input
              name="key"
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              minLength={10}
              disabled={busy}
              required
            />
          </label>
          <button disabled={busy}>Detectar mis canales de Buffer</button>
        </form>
        <p>
          Alternativa sin integraciones: descarga el paquete final aprobado y
          súbelo en el editor oficial. Los archivos y textos quedan listos;
          BrainOS no lo marca publicado automáticamente.
        </p>
      </section>
      <section className="panel">
        <h2>Identidad de handles</h2>
        <p>
          Las propuestas son editables. No hemos comprobado disponibilidad ni
          reservado nombres.
        </p>
        <form
          key={`handle:${state.entities.find((e) => e.kind === "handle")?.version ?? 0}`}
          onSubmit={(e) =>
            submit(e, (d) => ({
              action: "handle",
              name: d.get("handle"),
              fallbacks: String(d.get("fallbacks") || "")
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
              available: d.get("available") === "on",
            }))
          }
        >
          <label>
            Handle deseado
            <input
              name="handle"
              required
              defaultValue={String(
                state.entities.find((e) => e.kind === "handle")?.data.name ??
                  "",
              )}
            />
          </label>
          <label>
            Alternativas, separadas por comas
            <input
              name="fallbacks"
              defaultValue={(
                (state.entities.find((e) => e.kind === "handle")?.data
                  .fallbacks ?? []) as string[]
              ).join(", ")}
            />
          </label>
          <label>
            <input type="checkbox" name="available" />
            Comprobé disponibilidad personalmente
          </label>
          <button disabled={busy}>Guardar identidad</button>
        </form>
      </section>
      {state.providers.map((p) => (
        <section className="panel" key={p.platform}>
          <h2>{p.platform}</h2>
          <p>
            <strong>
              {p.account?.data.creation_state === "created" ? "CREATED · " : ""}
              {String(
                p.account?.data.status ??
                  (p.blocker === "BLOCKED_ACCOUNT_RECOVERY"
                    ? p.blocker
                    : "NOT_CREATED"),
              ).toUpperCase()}
            </strong>{" "}
            · {p.engineering}
          </p>
          <p>
            {p.blocker === "BLOCKED_ACCOUNT_RECOVERY"
              ? "Recupera tu cuenta de X antes de conectarla. No se creará ni conectará una cuenta."
              : p.free_connector
                ? "Usa la conexión gratuita de Buffer de arriba. La integración directa sigue disponible como alternativa avanzada."
                : String(p.blocker)}
          </p>
          <p>
            Conexión elegida: {String(p.account?.data.adapter ?? p.transport)}
            {p.transport === "buffer" ? ` · ${String(p.blocker)}` : ""}
          </p>
          <p>
            <strong>
              {p.account?.data.writes_authorized === true
                ? "Envíos autorizados"
                : "Envíos deshabilitados"}
            </strong>
          </p>
          {p.account &&
            (p.account.data.writes_authorized === true ||
              (!p.account.is_demo &&
                p.account.data.status === "connected" &&
                !!p.account.data.verified_at &&
                !!p.account.data.external_id &&
                (p.capabilities as string[]).includes("publish"))) && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (busy || !writeConfirmations[p.account!.id]) return;
                  const id = p.account!.id;
                  setWriteConfirmations((previous) => ({
                    ...previous,
                    [id]: false,
                  }));
                  void save({
                    action: "distribution_authorize",
                    id,
                    enabled: p.account!.data.writes_authorized !== true,
                    confirmed: true,
                  });
                }}
              >
                <h3>Permiso de envío para {p.platform}</h3>
                <p>
                  Cuenta:{" "}
                  {String(p.account.data.handle || p.account.data.external_id)}.
                  Conectar o volver a conectar deja los envíos deshabilitados
                  hasta que los autorices aquí.
                </p>
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={writeConfirmations[p.account.id] ?? false}
                    disabled={busy}
                    onChange={(event) => {
                      const checked = event.target.checked,
                        id = p.account!.id;
                      setWriteConfirmations((previous) => ({
                        ...previous,
                        [id]: checked,
                      }));
                    }}
                  />
                  {p.account.data.writes_authorized === true
                    ? `Confirmo que quiero deshabilitar los futuros envíos de BrainOS a esta cuenta de ${p.platform}.`
                    : `Autorizo futuros envíos de BrainOS a esta cuenta de ${p.platform}, únicamente de paquetes con aprobación final vigente y una acción de entrega confirmada.`}
                </label>
                <button disabled={busy || !writeConfirmations[p.account.id]}>
                  {p.account.data.writes_authorized === true
                    ? "Deshabilitar envíos de esta cuenta"
                    : "Autorizar envíos de esta cuenta"}
                </button>
                <p>
                  Esta decisión no aprueba contenido ni envía una publicación
                  ahora. Puedes retirar el permiso desde esta misma pantalla.
                </p>
              </form>
            )}
          {p.blocker !== "BLOCKED_ACCOUNT_RECOVERY" && (
            <a href={p.signup} target="_blank" rel="noopener noreferrer">
              Crear cuenta en el sitio oficial ↗
            </a>
          )}
          <form
            key={`account:${p.account?.id ?? p.platform}:${p.account?.version ?? 0}`}
            onSubmit={(e) =>
              submit(e, (d) => ({
                action: "created",
                provider: p.platform,
                handle: d.get("handle"),
              }))
            }
          >
            <label>
              Handle de la cuenta creada
              <input
                name="handle"
                required
                defaultValue={String(p.account?.data.handle ?? "")}
              />
            </label>
            <button disabled={busy || p.blocker === "BLOCKED_ACCOUNT_RECOVERY"}>
              Registrar cuenta creada
            </button>
          </form>
          {p.account && (
            <>
              <form
                key={`checklist:${p.account.id}:${p.account.version}`}
                onSubmit={(e) =>
                  submit(e, (d) => ({
                    action: "checklist",
                    id: p.account!.id,
                    two_factor: d.get("two_factor") === "on",
                    recovery_stored: d.get("recovery_stored") === "on",
                    email_strategy: d.get("email_strategy"),
                  }))
                }
              >
                <label>
                  Estrategia de email
                  <input
                    name="email_strategy"
                    defaultValue={String(p.account.data.email_strategy ?? "")}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="two_factor"
                    defaultChecked={!!p.account.data.two_factor}
                  />
                  2FA configurado
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="recovery_stored"
                    defaultChecked={!!p.account.data.recovery_stored}
                  />
                  Guardé códigos de recuperación fuera de BrainOS
                </label>
                <button disabled={busy}>Guardar checklist</button>
              </form>
              {p.platform === "beehiiv" ? (
                <form
                  onSubmit={(e) => {
                    const form = e.currentTarget;
                    submit(e, (d) => ({
                      action: "beehiiv_key",
                      id: p.account!.id,
                      key: d.get("key"),
                    }));
                    form.reset();
                  }}
                >
                  <label>
                    API key privada
                    <input
                      type="password"
                      name="key"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      minLength={10}
                      disabled={busy}
                      required
                    />
                  </label>
                  <button disabled={busy}>Conectar con API key</button>
                </form>
              ) : (
                <button
                  disabled={busy || !p.app_configured}
                  onClick={() =>
                    save({
                      action: "auth_start",
                      provider: p.platform,
                      id: p.account!.id,
                    })
                  }
                >
                  {p.platform === "youtube"
                    ? "Connect YouTube"
                    : `Conectar ${p.platform}`}
                  {p.free_connector ? " (integración directa)" : ""}
                </button>
              )}
              {Array.isArray(p.account.data.choices) &&
                p.account.data.choices.length > 0 && (
                  <p>
                    Selecciona el canal que BrainOS debe usar. La conexión y los
                    envíos quedan pendientes hasta confirmar esta identidad;
                    después debes autorizar los envíos por separado.
                  </p>
                )}
              {Array.isArray(p.account.data.choices) &&
                (
                  p.account.data.choices as {
                    id: string;
                    name: string;
                    handle: string;
                  }[]
                ).map((v) => (
                  <button
                    key={v.id}
                    disabled={busy}
                    onClick={() =>
                      save({
                        action: "select",
                        id: p.account!.id,
                        external_id: v.id,
                      })
                    }
                  >
                    Usar {v.name} / {v.handle} · ID: {v.id}
                  </button>
                ))}
              <p>
                Capacidades verificadas:{" "}
                {(p.capabilities as string[]).join(", ") || "ninguna"}
              </p>
              {p.transport === "buffer" && !!p.account.data.profile && (
                <details>
                  <summary>Capacidades del canal de Buffer</summary>
                  <dl>
                    {Object.entries(
                      (
                        p.account.data.profile as {
                          raw?: {
                            buffer_capabilities?: Record<string, unknown>;
                          };
                        }
                      ).raw?.buffer_capabilities ?? {},
                    )
                      .filter(
                        ([, v]) =>
                          v === null ||
                          typeof v === "boolean" ||
                          typeof v === "string",
                      )
                      .map(([name, value]) => (
                        <div key={name}>
                          <dt>{name}</dt>
                          <dd>
                            {value === null
                              ? "Por verificar"
                              : value === true
                                ? "Sí"
                                : value === false
                                  ? "No"
                                  : String(value)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </details>
              )}
              <button
                disabled={busy}
                onClick={() => {
                  if (confirm("Desconectar y eliminar la credencial local?"))
                    save({
                      action: "disconnect",
                      id: p.account!.id,
                      confirmed: true,
                    });
                }}
              >
                Desconectar
              </button>
            </>
          )}
          <h3>Paquete de perfil</h3>
          <button
            disabled={busy}
            onClick={() =>
              save({ action: "profile_generate", provider: p.platform })
            }
          >
            Generar borrador desde marca aprobada
          </button>
          {p.profile && (
            <>
              <p>
                {String(p.profile.data.status).toUpperCase()} · Avatar:{" "}
                {String(p.profile.data.avatar)} · Comparación: {p.drift.status}
              </p>
              <form
                key={`profile:${p.profile.id}:${p.profile.version}`}
                onSubmit={(e) =>
                  submit(e, (d) => ({
                    action: "profile_save",
                    id: p.profile!.id,
                    name: d.get("name"),
                    handle: d.get("handle"),
                    bio: d.get("bio"),
                    link: d.get("link"),
                    category: d.get("category"),
                  }))
                }
              >
                <label>
                  Nombre
                  <input
                    name="name"
                    required
                    defaultValue={String(p.profile.data.name)}
                  />
                </label>
                <label>
                  Handle
                  <input
                    name="handle"
                    required
                    defaultValue={String(p.profile.data.handle)}
                  />
                </label>
                <label>
                  Bio / descripción
                  <textarea
                    name="bio"
                    defaultValue={String(p.profile.data.bio)}
                  />
                </label>
                <label>
                  Link
                  <input
                    name="link"
                    type="url"
                    required
                    defaultValue={String(p.profile.data.link)}
                  />
                </label>
                <label>
                  Categoría
                  <input
                    name="category"
                    required
                    defaultValue={String(p.profile.data.category)}
                  />
                </label>
                <button disabled={busy || p.profile.data.status === "approved"}>
                  Guardar borrador
                </button>
              </form>
              <button
                disabled={busy || p.profile.data.status === "approved"}
                onClick={() => {
                  if (confirm("Aprobar esta revisión exacta del perfil?"))
                    save({
                      action: "profile_approve",
                      id: p.profile!.id,
                      confirmed: true,
                    });
                }}
              >
                Aprobar perfil
              </button>
            </>
          )}
        </section>
      ))}
      <section className="panel" id="distribution">
        <h2>Estado de distribución</h2>
        <p>
          Estado observado del outbox y del proveedor. Un borrador o una cola no
          confirma publicación.
        </p>
        {state.distribution.length ? (
          state.distribution.map((r) => (
            <p key={r.id}>
              {r.provider} · {r.status} ·{" "}
              {r.remote_status ?? "sin envío remoto"}
              {r.error ? ` · ${r.error}` : ""}
              {r.url ? (
                <>
                  {" "}
                  ·{" "}
                  <a href={r.url} target="_blank" rel="noopener noreferrer">
                    Ver publicación
                  </a>
                </>
              ) : null}
            </p>
          ))
        ) : (
          <p>Sin envíos autorizados.</p>
        )}
      </section>
      <section className="panel">
        <h2>Brand Launch V1</h2>
        <button
          disabled={busy}
          onClick={() => save({ action: "launch_initialize" })}
        >
          Preparar ocho slots y estructura BrainOS
        </button>
        <p>Ningún guion u opinión se aprueba automáticamente.</p>
        <a href="/recording-demo">
          Abrir demo seguro para grabación (datos ficticios)
        </a>
        {state.entities
          .filter((e) => e.kind === "launch_plan")
          .map((e) => (
            <div key={e.id}>
              <h3>{String(e.data.name)}</h3>
              <h4>Assets de marca pendientes</h4>
              {(
                (e.data.asset_requirements ?? []) as {
                  slot: string;
                  status: string;
                }[]
              ).map((asset) => (
                <p key={asset.slot}>
                  {asset.slot} — {asset.status}
                </p>
              ))}
              {state.launch_slots.map((s) => (
                <p key={s.title}>
                  {s.title} — {s.readiness.ready ? "READY" : "BLOCKED"} ·{" "}
                  {s.readiness.issues.join(" · ")}
                </p>
              ))}
            </div>
          ))}
      </section>
    </main>
  );
}
