"use client";
import { useState } from "react";
import { PageHeader } from "./ui";
import { Button, Input, StatusChip } from "./design/primitives";
import {
  humanStatus,
  connectionPresentation,
  capabilityLabel,
} from "./design/status";
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
      <section className="page account-activation">
        <h1>Account Activation</h1>
        <p role="status">{message || "Cargando…"}</p>
      </section>
    );
  return (
    <section className="page account-activation">
      <PageHeader
        eyebrow="DISTRIBUTION / INTEGRATIONS"
        title="Account Activation"
        description="Your channels, clearly connected. Capabilities and human release permissions stay separate."
      />
      <div className="activation-overview">
        <span className="small-cap">VERIFIED CONNECTIONS</span>
        <strong>
          {
            state.providers.filter(
              (p) => p.account?.data.status === "connected",
            ).length
          }
          <span> / 5</span>
        </strong>
        <p>Connection opens the workflow. It never approves a publication.</p>
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <details className="panel activation-setup">
        <summary>Buffer · API key & channel discovery</summary>
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
            <Input
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
          <Button disabled={busy}>Detectar mis canales de Buffer</Button>
        </form>
        <p>
          Alternativa sin integraciones: descarga el paquete final aprobado y
          súbelo en el editor oficial. Los archivos y textos quedan listos;
          BrainOS no lo marca publicado automáticamente.
        </p>
      </details>
      <details className="panel activation-setup">
        <summary>Creator identity · handles</summary>
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
            <Input
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
            <Input
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
          <Button disabled={busy}>Guardar identidad</Button>
        </form>
      </details>
      <div className="provider-list">
        {state.providers.map((p) => (
          <section
            className="panel provider-panel"
            key={p.platform}
            data-provider={p.platform}
          >
            <div className="provider-heading">
              <div>
                <span className="eyebrow">
                  {p.platform === "beehiiv"
                    ? "NEWSLETTER"
                    : "DISTRIBUTION CHANNEL"}
                </span>
                <h2>
                  {p.platform === "youtube"
                    ? "YouTube"
                    : p.platform === "tiktok"
                      ? "TikTok"
                      : p.platform === "instagram"
                        ? "Instagram"
                        : p.platform === "x"
                          ? "X"
                          : "beehiiv"}
                </h2>
                <p className="provider-identity">
                  {p.account?.data.handle
                    ? `${p.platform === "beehiiv" ? "" : "@"}${String(p.account.data.handle)}`
                    : "Identity pending"}
                  <span>
                    {p.transport === "buffer"
                      ? "via Buffer"
                      : p.platform === "youtube"
                        ? "YouTube direct"
                        : p.platform === "beehiiv"
                          ? "Publication API"
                          : p.blocker === "BLOCKED_ACCOUNT_RECOVERY"
                            ? "Recovery on hold"
                            : "Connection not chosen"}
                  </span>
                </p>
              </div>
              <StatusChip
                {...{
                  tone: connectionPresentation(
                    p.account?.data.status,
                    p.blocker,
                  ).tone,
                }}
              >
                {
                  connectionPresentation(p.account?.data.status, p.blocker)
                    .label
                }
              </StatusChip>
            </div>
            <dl className="provider-summary">
              <div>
                <dt>Account</dt>
                <dd>
                  {p.account?.data.creation_state === "created"
                    ? "Created"
                    : p.blocker === "BLOCKED_ACCOUNT_RECOVERY"
                      ? "Recovery required"
                      : "Not registered"}
                </dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd>
                  <StatusChip
                    tone={
                      connectionPresentation(p.account?.data.status, p.blocker)
                        .tone
                    }
                  >
                    {
                      connectionPresentation(p.account?.data.status, p.blocker)
                        .label
                    }
                  </StatusChip>
                </dd>
              </div>
              <div className="provider-capabilities">
                <dt>Capabilities</dt>
                <dd>
                  {(p.capabilities as string[]).length
                    ? (p.capabilities as string[]).map((c) => (
                        <span className="capability-tag" key={c}>
                          {capabilityLabel(c, p.platform, p.blocker)}{" "}
                          <span aria-label="available">✓</span>
                        </span>
                      ))
                    : "Awaiting verification"}
                </dd>
              </div>
              <div>
                <dt>Send authorization</dt>
                <dd>
                  <StatusChip
                    tone={
                      p.account?.data.writes_authorized === true
                        ? "positive"
                        : "neutral"
                    }
                  >
                    {p.account?.data.writes_authorized === true
                      ? "Authorized · final approval required"
                      : "Disabled"}
                  </StatusChip>
                </dd>
              </div>
              <div>
                <dt>Profile</dt>
                <dd>
                  {p.profile
                    ? humanStatus(p.profile.data.status)
                    : "Draft not prepared"}
                </dd>
              </div>
            </dl>
            {!!p.blocker &&
              !["Buffer connected", "Create account and connect"].includes(
                String(p.blocker),
              ) && (
                <div className="provider-blocker">
                  <span className="small-cap">CAPABILITY / NEXT ACTION</span>
                  <p>
                    {p.free_connector &&
                    !p.account &&
                    p.blocker !== "BLOCKED_ACCOUNT_RECOVERY"
                      ? "Connect Buffer to discover this channel"
                      : humanStatus(p.blocker)}
                  </p>
                  {p.blocker === "YOUTUBE_PROJECT_AUDIT_PRIVATE_ONLY" && (
                    <small>
                      Connected. Private upload and analytics are available.
                      Public automated uploads require Google’s project audit.
                    </small>
                  )}
                  {p.blocker === "BEEHIIV_POSTS_PLAN_ACCESS_REQUIRED" && (
                    <small>
                      Connected. Publication, subscriber and post reads are
                      available. Use the approved native handoff for sending.
                    </small>
                  )}
                  {p.blocker === "BLOCKED_ACCOUNT_RECOVERY" && (
                    <small>
                      Recover the existing account directly with X. BrainOS will
                      not create or connect an alternative.
                    </small>
                  )}
                </div>
              )}
            <details className="provider-details">
              <summary>Connection, permissions & profile</summary>
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
                      {String(
                        p.account.data.handle || p.account.data.external_id,
                      )}
                      . Conectar o volver a conectar deja los envíos
                      deshabilitados hasta que los autorices aquí.
                    </p>
                    <label className="consent">
                      <Input
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
                    <Button
                      disabled={busy || !writeConfirmations[p.account.id]}
                    >
                      {p.account.data.writes_authorized === true
                        ? "Deshabilitar envíos de esta cuenta"
                        : "Autorizar envíos de esta cuenta"}
                    </Button>
                    <p>
                      Esta decisión no aprueba contenido ni envía una
                      publicación ahora. Puedes retirar el permiso desde esta
                      misma pantalla.
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
                  <Input
                    name="handle"
                    required
                    defaultValue={String(p.account?.data.handle ?? "")}
                  />
                </label>
                <Button
                  disabled={busy || p.blocker === "BLOCKED_ACCOUNT_RECOVERY"}
                >
                  Registrar cuenta creada
                </Button>
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
                      <Input
                        name="email_strategy"
                        defaultValue={String(
                          p.account.data.email_strategy ?? "",
                        )}
                      />
                    </label>
                    <label>
                      <Input
                        type="checkbox"
                        name="two_factor"
                        defaultChecked={!!p.account.data.two_factor}
                      />
                      2FA configurado
                    </label>
                    <label>
                      <Input
                        type="checkbox"
                        name="recovery_stored"
                        defaultChecked={!!p.account.data.recovery_stored}
                      />
                      Guardé códigos de recuperación fuera de BrainOS
                    </label>
                    <Button disabled={busy}>Guardar checklist</Button>
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
                        <Input
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
                      <Button disabled={busy}>Conectar con API key</Button>
                    </form>
                  ) : (
                    <Button
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
                        ? p.account.data.status === "connected"
                          ? "Reconnect YouTube"
                          : "Connect YouTube"
                        : `${p.account.data.status === "connected" ? "Reconectar" : "Conectar"} ${p.platform}`}
                      {p.free_connector ? " (integración directa)" : ""}
                    </Button>
                  )}
                  {Array.isArray(p.account.data.choices) &&
                    p.account.data.choices.length > 0 && (
                      <p>
                        Selecciona el canal que BrainOS debe usar. La conexión y
                        los envíos quedan pendientes hasta confirmar esta
                        identidad; después debes autorizar los envíos por
                        separado.
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
                      <Button
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
                      </Button>
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
                  <Button
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm("Desconectar y eliminar la credencial local?")
                      )
                        save({
                          action: "disconnect",
                          id: p.account!.id,
                          confirmed: true,
                        });
                    }}
                  >
                    Desconectar
                  </Button>
                </>
              )}
              <h3>Paquete de perfil</h3>
              <Button
                disabled={busy}
                onClick={() =>
                  save({ action: "profile_generate", provider: p.platform })
                }
              >
                Generar borrador desde marca aprobada
              </Button>
              {p.profile && (
                <>
                  <p>
                    {humanStatus(p.profile.data.status)} · Avatar:{" "}
                    {humanStatus(p.profile.data.avatar)} · Comparación:{" "}
                    {humanStatus(p.drift.status)}
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
                      <Input
                        name="name"
                        required
                        defaultValue={String(p.profile.data.name)}
                      />
                    </label>
                    <label>
                      Handle
                      <Input
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
                      <Input
                        name="link"
                        type="url"
                        required
                        defaultValue={String(p.profile.data.link)}
                      />
                    </label>
                    <label>
                      Categoría
                      <Input
                        name="category"
                        required
                        defaultValue={String(p.profile.data.category)}
                      />
                    </label>
                    <Button
                      disabled={busy || p.profile.data.status === "approved"}
                    >
                      Guardar borrador
                    </Button>
                  </form>
                  <Button
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
                  </Button>
                </>
              )}
              <details className="technical-details">
                <summary>Technical metadata</summary>
                <dl className="metadata">
                  <dt>Provider state</dt>
                  <dd>
                    <code>
                      {String(p.account?.data.status ?? p.engineering)}
                    </code>
                  </dd>
                  <dt>Adapter</dt>
                  <dd>
                    <code>
                      {String(p.account?.data.adapter ?? p.transport)}
                    </code>
                  </dd>
                  <dt>Remote identity</dt>
                  <dd>
                    <code>
                      {String(p.account?.data.external_id ?? "Unassigned")}
                    </code>
                  </dd>
                  <dt>Provider limit</dt>
                  <dd>
                    <code>{String(p.blocker ?? "None")}</code>
                  </dd>
                </dl>
              </details>
            </details>
          </section>
        ))}
      </div>
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
        <Button
          disabled={busy}
          onClick={() => save({ action: "launch_initialize" })}
        >
          Preparar ocho slots y estructura BrainOS
        </Button>
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
                  {asset.slot} — {humanStatus(asset.status)}
                </p>
              ))}
              {state.launch_slots.map((s) => (
                <p key={s.title}>
                  {s.title} — {s.readiness.ready ? "Ready" : "Action needed"} ·{" "}
                  {s.readiness.issues.join(" · ")}
                </p>
              ))}
            </div>
          ))}
      </section>
    </section>
  );
}
