"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DriveConnectionStatus } from "@/integrations/drive-status";
import Link from "next/link";
import type { Story } from "@/domain/types";
import type {
  StudioState,
  ProductionPackage,
  RecordingMedia,
  RenderOptions,
} from "@/production/types";
const endpoint = "/api/production/studio";
const href = (p: ProductionPackage, format: string) =>
  `${endpoint}?id=${p.id}&format=${format}`;
export function ProductionStudio({
  initial,
  stories,
  driveStatus,
}: {
  initial: StudioState;
  stories: Story[];
  driveStatus: DriveConnectionStatus;
}) {
  const router = useRouter();
  const requested = useSearchParams().get("package");
  const [state, setState] = useState(initial),
    [selected, setSelected] = useState<string[]>([]),
    [active, setActive] = useState(
      initial.packages.find((p) => p.id === requested)?.id ??
        initial.packages[0]?.id ??
        "",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const p = state.packages.find((p) => p.id === active),
    story = stories.find((s) => s.id === p?.story_id);
  async function refresh() {
    const r = await fetch(endpoint);
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    const ids = new Set(stories.map((s) => s.id));
    d.packages = d.packages.filter((p: ProductionPackage) =>
      ids.has(p.story_id),
    );
    setState(d);
    router.refresh();
  }
  async function request(body: unknown) {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await r.json();
    if (!r.ok) throw Error(result.error);
    return result;
  }
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await request({
        ...body,
        ...(body.action === "create" ||
        body.action === "batch" ||
        body.action === "retry"
          ? {}
          : { id: p!.id, version: p!.version }),
      });
      if (body.action === "create") setActive(result.id);
      await refresh();
      setMessage("Guardado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File, owned: boolean) {
    if (!p) return;
    setBusy(true);
    setError("");
    try {
      if (!owned) throw Error("Confirma que es tu grabación.");
      const ticket = await request({
        action: "upload",
        id: p.id,
        version: p.version,
        filename: file.name,
        mime: file.type,
        bytes: file.size,
      });
      const r = await fetch(ticket.url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!r.ok)
        throw Error(
          "Falló la carga; conserva el archivo original y vuelve a intentar.",
        );
      const media: RecordingMedia = {
        id: crypto.randomUUID(),
        story_id: p.story_id,
        draft_id: p.draft_id,
        provider: "supabase",
        file_id: ticket.file_id,
        filename: file.name,
        mime: file.type,
        bytes: file.size,
        duration: null,
        captured_at: null,
        uploaded_at: new Date().toISOString(),
        owned_confirmed: true,
        status: "received",
      };
      await request({ action: "media", id: p.id, version: p.version, media });
      await refresh();
      setMessage("Grabación recibida. Puedes encolar la transcripción.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }
  const approved = stories.flatMap((s) =>
    s.drafts
      .filter((d) => d.status === "approved" && s.active_draft_id === d.id)
      .map((d) => ({ s, d })),
  );
  return (
    <div className="studio">
      <div className="studio-toolbar">
        <Link href="/production">← Producción editorial</Link>
        <button
          className="button quiet"
          disabled={busy}
          onClick={() => refresh().catch((e) => setError(e.message))}
        >
          Actualizar estados
        </button>
        {driveStatus.state === "connected" ? (
          <span role="status" data-testid="drive-connection-status">
            <strong>Drive connected</strong> · {driveStatus.email}
            {" · "}
            <a
              href={`https://drive.google.com/drive/folders/${driveStatus.root}`}
              target="_blank"
              rel="noreferrer"
            >
              Daniel AI Content OS
            </a>
          </span>
        ) : driveStatus.state === "disconnected" ? (
          <Link href="/api/integrations/google/start">Conectar Drive</Link>
        ) : driveStatus.state === "unavailable" ? (
          <span role="status">
            No se pudo verificar Drive. Actualiza los estados para reintentar.{" "}
            <Link href="/api/integrations/google/start">Reconectar Drive</Link>
          </span>
        ) : (
          <span>
            Drive pendiente de configuración OAuth. Puedes subir o registrar
            archivos locales.
          </span>
        )}
      </div>
      {error && (
        <p className="notice studio-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <section className="panel">
        <h2>1. Preparar la sesión</h2>
        <p>
          Aprueba el ángulo y la revisión del guion en el espacio editorial. Un
          cambio del guion invalida su paquete.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void act({ action: "create", draft_id: d.get("draft") });
          }}
        >
          <label>
            Guion aprobado
            <select name="draft" required>
              {approved.map(({ s, d }) => (
                <option key={d.id} value={d.id}>
                  {s.is_demo ? "[DEMO] " : ""}
                  {s.title} · r{d.revision} · {d.platform}
                </option>
              ))}
            </select>
          </label>
          <button className="button" disabled={busy || !approved.length}>
            Crear paquete de grabación
          </button>
        </form>
        {!approved.length && (
          <p>
            No hay guiones aprobados disponibles.{" "}
            <Link href="/review">Abrir revisión editorial</Link>.
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Grabación por lotes</h2>
        <p>
          Selecciona 3–10 piezas. Estimación:{" "}
          {Math.ceil(
            state.packages
              .filter((p) => selected.includes(p.id))
              .reduce(
                (sum, p) => sum + (p.data.packet.target_duration ?? 60) + 30,
                0,
              ) / 60,
          )}{" "}
          minutos, con 30 s de preparación por pieza.
        </p>
        {state.packages.map((pkg) => (
          <div className="studio-piece" key={pkg.id}>
            <label className="check">
              <input
                type="checkbox"
                disabled={!pkg.valid}
                checked={selected.includes(pkg.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, pkg.id]
                      : selected.filter((id) => id !== pkg.id),
                  )
                }
              />
              {pkg.data.title} · r{pkg.data.packet.revision}
            </label>
            <span>
              {!pkg.valid
                ? "REVISIÓN INVALIDADA"
                : pkg.data.media.length
                  ? "Grabado"
                  : "Por grabar"}
            </span>
            <button className="button quiet" onClick={() => setActive(pkg.id)}>
              Abrir
            </button>
          </div>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act({
              action: "batch",
              name: new FormData(e.currentTarget).get("name"),
              package_ids: selected,
            });
          }}
        >
          <label>
            Nombre del lote
            <input name="name" required defaultValue="Sesión de grabación" />
          </label>
          <button
            className="button secondary"
            disabled={busy || selected.length < 3 || selected.length > 10}
          >
            Guardar lote ({selected.length})
          </button>
        </form>
        {state.batches.map((b) => (
          <details key={b.id}>
            <summary>
              {b.name} · {b.package_ids.length} piezas
            </summary>
            <p>
              <a
                target="_blank"
                href={`${endpoint}?batch=${b.id}&format=teleprompter`}
              >
                Secuencia de teleprompter
              </a>{" "}
              ·{" "}
              <a href={`${endpoint}?batch=${b.id}&format=package`}>
                Exportar paquetes
              </a>
            </p>
            <ul>
              {Array.from(
                new Set(
                  b.package_ids.flatMap(
                    (id) =>
                      state.packages.find((p) => p.id === id)?.data.packet
                        .checklist ?? [],
                  ),
                ),
              ).map((c) => (
                <li key={c}>
                  <label>
                    <input type="checkbox" /> {c}
                  </label>
                </li>
              ))}
            </ul>
            {b.package_ids.map((id) => {
              const p = state.packages.find((p) => p.id === id);
              return (
                p && (
                  <p key={id}>
                    {!p.valid
                      ? "REVISIÓN INVALIDADA"
                      : p.data.media.length
                        ? "✓ Grabado"
                        : "○ Pendiente"}{" "}
                    · {p.data.title} ·{" "}
                    <a href={href(p, "package")}>Paquete individual</a>
                  </p>
                )
              );
            })}
          </details>
        ))}
      </section>
      {p && (
        <section className="panel studio-detail" key={p.id}>
          <div className="section-heading">
            <h2>{p.data.title}</h2>
            <span className="small-cap">
              r{p.data.packet.revision} · producción v{p.version} ·{" "}
              {p.data.state}
            </span>
          </div>
          <p>
            Ángulo: {story?.angles.find((a) => a.id === p.data.angle_id)?.text}
          </p>
          <p className="small-cap">{p.draft_id}</p>
          {!p.valid ? (
            <p className="notice studio-error">
              {p.invalid_reason} Conservamos los archivos y el historial.
              Aprueba una nueva revisión para crear otro paquete.
            </p>
          ) : (
            <>
              <nav className="studio-toolbar">
                <a href={href(p, "teleprompter")} target="_blank">
                  Teleprompter
                </a>
                <a href={href(p, "teleprompter") + "&download=1&emphasis=1"}>
                  Descargar HTML
                </a>
                <a href={href(p, "text") + "&download=1"}>Texto</a>
                <a href={href(p, "package")}>Paquete multiplataforma</a>
              </nav>
              <details>
                <summary>Guion, tomas, fuentes y checklist</summary>
                <h3>Hook</h3>
                <p>{p.data.packet.hook}</p>
                <p>
                  Objetivo: {p.data.packet.target_duration ?? "Sin definir"}{" "}
                  segundos
                </p>
                <pre className="studio-script">{p.data.packet.script}</pre>
                <h3>CTA</h3>
                <p>{p.data.packet.cta}</p>
                <ul>
                  {p.data.packet.shot_list.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <h3>Fuentes / recordatorios</h3>
                {p.data.packet.source_urls.map((s) => (
                  <p key={s}>
                    <a href={s} target="_blank" rel="noreferrer">
                      {s}
                    </a>
                  </p>
                ))}
                <ul>
                  {p.data.packet.checklist.map((c) => (
                    <li key={c}>
                      <label>
                        <input type="checkbox" /> {c}
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
              <h3>2. Recibir grabación</h3>
              <p>
                Originales intactos. Carga directa privada hasta 50 MB; para
                archivos grandes, Drive o el worker local.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget),
                    f = d.get("file");
                  if (f instanceof File)
                    void upload(f, d.get("owned") === "on");
                }}
              >
                <input
                  name="file"
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,audio/*"
                  required
                />
                <label className="check">
                  <input type="checkbox" name="owned" required />
                  Es una grabación propia de Daniel; tengo derecho a usarla.
                </label>
                <button className="button" disabled={busy}>
                  Subir grabación
                </button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  void act({
                    action: "media",
                    media: {
                      id: crypto.randomUUID(),
                      story_id: p.story_id,
                      draft_id: p.draft_id,
                      provider: "drive",
                      file_id: d.get("drive"),
                      filename: "Drive recording",
                      mime: "video/mp4",
                      bytes: 1,
                      duration: null,
                      captured_at: null,
                      uploaded_at: new Date().toISOString(),
                      owned_confirmed: true,
                      status: "received",
                    },
                  });
                }}
              >
                <label>
                  ID estable de archivo en Drive
                  <input
                    name="drive"
                    required
                    placeholder="ID dentro de Daniel AI Content OS"
                  />
                </label>
                <label className="check">
                  <input type="checkbox" required />
                  Confirmo que es mi grabación.
                </label>
                <button className="button secondary" disabled={busy}>
                  Vincular sin duplicar
                </button>
              </form>
              <details>
                <summary>Archivo local en tu Mac</summary>
                <p>Coloca la grabación dentro de MEDIA_INPUT_ROOT y ejecuta:</p>
                <code>
                  .venv-media/bin/python scripts/media/worker.py register
                  --package {p.id} --file /ruta/a/grabacion.mp4 --owned
                </code>
                <p>El worker lee el archivo local; no necesitas copiar JSON.</p>
              </details>
              <ul>
                {p.data.media.map((m) => (
                  <li key={m.id}>
                    {m.filename} · {m.provider} · {(m.bytes / 1e6).toFixed(1)}{" "}
                    MB · {m.duration?.toFixed(1) ?? "?"} s · {m.status}
                  </li>
                ))}
              </ul>
              <button
                className="button"
                disabled={busy || p.data.state !== "recording_received"}
                onClick={() => act({ action: "transcribe" })}
              >
                Encolar transcripción local
              </button>
              <h3>3. Revisar transcripción y edición</h3>
              {p.data.transcript && (
                <>
                  <p>
                    {p.data.transcript.provider} · {p.data.transcript.language}{" "}
                    ·{" "}
                    {p.data.transcript.reviewed
                      ? "Revisada"
                      : "Pendiente de revisión"}
                  </p>
                  <details>
                    <summary>Segmentos con tiempos originales</summary>
                    {p.data.transcript.segments.map((s, i) => (
                      <p key={i}>
                        <strong>
                          {s.start.toFixed(2)}–{s.end.toFixed(2)} s
                        </strong>{" "}
                        {s.text}
                      </p>
                    ))}
                  </details>
                  <nav className="studio-toolbar">
                    {["srt", "vtt", "json"].map((f) => (
                      <a key={f} href={href(p, f)}>
                        Descargar {f.toUpperCase()}
                      </a>
                    ))}
                  </nav>
                  <button
                    className="button secondary"
                    disabled={
                      busy ||
                      ![
                        "transcribed",
                        "edit_plan_ready",
                        "assets_ready",
                        "render_ready",
                      ].includes(p.data.state)
                    }
                    onClick={() =>
                      act({ action: "review_transcript", confirmed: true })
                    }
                  >
                    Confirmar transcripción tras escuchar
                  </button>
                  <button
                    className="button secondary"
                    disabled={
                      busy ||
                      !["transcribed", "edit_plan_ready"].includes(p.data.state)
                    }
                    onClick={() => act({ action: "plan" })}
                  >
                    Preparar plan de edición
                  </button>
                </>
              )}
              {p.data.edit_plan && (
                <>
                  <p>
                    Coincidencia de palabras con el guion:{" "}
                    {p.data.edit_plan.script_coverage}%. Revisa omisiones y
                    cambios. Sugerencias deterministas; no se corta el original.
                    Los tiempos corresponden al archivo fuente.
                  </p>
                  <ul>
                    {p.data.edit_plan.markers.map((m, i) => (
                      <li key={i}>
                        {m.start.toFixed(2)}–{m.end.toFixed(2)} s · {m.kind}:{" "}
                        {m.reason}
                      </li>
                    ))}
                  </ul>
                  <button
                    className="button secondary"
                    disabled={
                      busy ||
                      ![
                        "edit_plan_ready",
                        "assets_ready",
                        "render_ready",
                      ].includes(p.data.state)
                    }
                    onClick={() =>
                      act({ action: "review_plan", confirmed: true })
                    }
                  >
                    Confirmar plan tras revisar los cortes
                  </button>
                </>
              )}
              <h3>4. B-roll, gráficos y derechos</h3>
              <p>
                Preferencia: material propio → oficial con permiso → licenciado
                → stock → ilustración. Los candidatos opcionales no se incluyen
                en el render. Los necesarios requieren derechos resueltos.
              </p>
              {p.data.assets.map((a) => (
                <details key={a.id}>
                  <summary>
                    {a.title} · {a.rights} ·{" "}
                    {a.required ? "Necesario" : "Candidato opcional"}
                  </summary>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const d = new FormData(e.currentTarget);
                      void act({
                        action: "asset",
                        asset_id: a.id,
                        required: d.get("required") === "on",
                        rights: d.get("rights"),
                        basis: d.get("basis"),
                        attribution: d.get("attribution"),
                        reference: d.get("reference"),
                        confirmed: d.get("confirmed") === "on",
                      });
                    }}
                  >
                    <label className="check">
                      <input
                        name="required"
                        type="checkbox"
                        defaultChecked={a.required}
                      />
                      Requerido para este paquete
                    </label>
                    <label>
                      Derechos
                      <select name="rights" defaultValue={a.rights}>
                        <option value="unknown">Desconocidos</option>
                        <option value="cleared">Autorizados</option>
                        <option value="blocked">Bloqueados</option>
                      </select>
                    </label>
                    <label>
                      Base de uso
                      <input name="basis" defaultValue={a.basis} />
                    </label>
                    <label>
                      Atribución
                      <input name="attribution" defaultValue={a.attribution} />
                    </label>
                    <label>
                      Archivo / referencia
                      <input name="reference" defaultValue={a.reference} />
                    </label>
                    <label className="check">
                      <input name="confirmed" type="checkbox" />
                      Verifiqué personalmente los derechos y la atribución.
                    </label>
                    <button className="button quiet" disabled={busy}>
                      Guardar derechos
                    </button>
                  </form>
                  {a.reference.startsWith(p.id + "/graphics/") && (
                    <a href={href(p, "graphic") + "&asset=" + a.id}>
                      Descargar SVG
                    </a>
                  )}
                </details>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  void act({
                    action: "graphic",
                    kind: d.get("kind"),
                    source_id: d.get("source"),
                    second_source_id: d.get("second") || undefined,
                    text: d.get("text") || undefined,
                  });
                }}
              >
                <label>
                  Gráfico
                  <select name="kind">
                    <option value="source">Fuente / evidencia</option>
                    <option value="quote">Cita exacta</option>
                    <option value="stat">Dato numérico</option>
                    <option value="comparison">Comparación de fuentes</option>
                  </select>
                </label>
                <label>
                  Fuente
                  <select name="source">
                    {story?.sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.publisher} · {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Segunda fuente (comparación)
                  <select name="second">
                    <option value="">Selecciona</option>
                    {story?.sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.publisher} · {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Cita / dato: extracto exacto de la fuente
                  <textarea name="text" maxLength={300} />
                </label>
                <button className="button secondary" disabled={busy}>
                  Generar tarjeta editorial
                </button>
              </form>
              <h3>5. Render y aprobación final</h3>
              <button
                className="button"
                disabled={
                  busy ||
                  !["edit_plan_ready", "assets_ready"].includes(p.data.state)
                }
                onClick={() => act({ action: "ready" })}
              >
                Validar paquete → render-ready
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  const options: RenderOptions = {
                    layout: d.get("layout") as RenderOptions["layout"],
                    normalize: d.get("normalize") === "on",
                    burn_subtitles: d.get("burn") === "on",
                    remove_pauses: d.get("silence") === "on",
                  };
                  void act({ action: "render", options });
                }}
              >
                <label>
                  Formato
                  <select name="layout">
                    <option value="vertical">
                      Vertical 9:16 · recorte centrado
                    </option>
                    <option value="original">
                      Conservar encuadre original
                    </option>
                  </select>
                </label>
                <label className="check">
                  <input name="normalize" type="checkbox" defaultChecked />
                  Normalizar audio
                </label>
                <label className="check">
                  <input name="burn" type="checkbox" />
                  Quemar subtítulos (requiere ffmpeg con libass)
                </label>
                <label className="check">
                  <input name="silence" type="checkbox" />
                  Aplicar intervalos del plan revisado; puedo revisar el
                  resultado antes de aprobar
                </label>
                <p>
                  Las inserciones de B-roll siguen siendo instrucciones para
                  edición humana. No se insertan imágenes automáticamente.
                </p>
                <button
                  className="button"
                  disabled={busy || p.data.state !== "render_ready"}
                >
                  Encolar render en mi Mac
                </button>
              </form>
              {p.data.output && (
                <>
                  <video
                    className="studio-video"
                    controls
                    preload="metadata"
                    src={href(p, "output")}
                  />
                  <p>
                    <a href={href(p, "srt") + "&timeline=render"}>
                      SRT del render
                    </a>
                    {" · "}
                    <a href={href(p, "vtt") + "&timeline=render"}>
                      VTT del render
                    </a>
                    {" · "}
                    <a href={href(p, "output")} target="_blank">
                      Abrir / descargar MP4
                    </a>{" "}
                    · {p.data.output.sha256.slice(0, 16)}…
                  </p>
                  <button
                    className="button secondary"
                    disabled={busy || p.data.state !== "rendered"}
                    onClick={() => act({ action: "review" })}
                  >
                    Enviar resultado a revisión final
                  </button>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act({ action: "approve", confirmed: true });
                    }}
                  >
                    <label className="check">
                      <input type="checkbox" required />
                      Revisé el video completo, los cortes, subtítulos, guion y
                      derechos de esta versión exacta.
                    </label>
                    <button
                      className="button"
                      disabled={busy || p.data.state !== "review"}
                    >
                      Aprobar producción v{p.version + 1}
                    </button>
                  </form>
                </>
              )}
              {p.data.approval && (
                <p className="notice">
                  Aprobación final · versión{" "}
                  {p.data.approval.production_version} · {p.data.approval.actor}
                  . No se publica automáticamente.
                </p>
              )}
            </>
          )}
          <h3>Trabajos del worker</h3>
          {state.jobs
            .filter((j) => j.package_id === p.id)
            .map((j) => (
              <div key={j.id}>
                <p>
                  {j.kind} · {j.status} · intento {j.attempts}
                  {j.error && ` · ${j.error}`}
                </p>
                {j.status === "failed" && (
                  <button
                    className="button quiet"
                    disabled={busy}
                    onClick={() => act({ action: "retry", job_id: j.id })}
                  >
                    Reintentar
                  </button>
                )}
              </div>
            ))}
          <p>
            En tu Mac:{" "}
            <code>.venv-media/bin/python scripts/media/worker.py watch</code>.
            Si está apagado, el trabajo permanece en cola.
          </p>
        </section>
      )}
    </div>
  );
}
