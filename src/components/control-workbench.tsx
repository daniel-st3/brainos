"use client";
import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { ControlState, Entity, Content, Package } from "@/control/model";
import type { Story } from "@/domain/types";
import type { StudioState } from "@/production/types";
type Option = { value: string; label: string };
function Field({
  name,
  label,
  options,
  value,
  optional = false,
  multiline = false,
}: {
  name: string;
  label: string;
  options?: Option[];
  value?: string;
  optional?: boolean;
  multiline?: boolean;
}) {
  return (
    <label>
      {label}
      {options ? (
        <select
          name={name}
          required={!optional}
          defaultValue={value ?? options[0]?.value}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : multiline ? (
        <textarea name={name} required={!optional} defaultValue={value} />
      ) : (
        <input name={name} required={!optional} defaultValue={value} />
      )}
    </label>
  );
}
function Form({
  send,
  busy,
  setError,
  title,
  children,
  build,
  confirm = false,
  label = "Save",
}: {
  send: (command: Record<string, unknown>) => Promise<void>;
  busy: boolean;
  setError: (message: string) => void;
  title: string;
  children?: ReactNode;
  build: (f: FormData) => Record<string, unknown>;
  confirm?: boolean;
  label?: string;
}) {
  return (
    <form
      className="control-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (confirm && f.get("confirmed") !== "on") {
          setError("Explicit review required");
          return;
        }
        try {
          void send({ ...build(f), ...(confirm ? { confirmed: true } : {}) });
        } catch (error) {
          setError(error instanceof Error ? error.message : "Invalid input");
        }
      }}
    >
      <h3>{title}</h3>
      {children}
      {confirm && (
        <label className="consent">
          <input type="checkbox" name="confirmed" required />I reviewed this
          exact revision and authorize this decision.
        </label>
      )}
      <button className="button dark" disabled={busy}>
        {label}
      </button>
    </form>
  );
}

export function Workbench({
  state,
  stories,
  production,
  accounts,
  campaigns,
}: {
  state: ControlState;
  stories: Story[];
  production: StudioState;
  accounts: {
    id: string | null;
    platform: string;
    status: string;
    handle: string;
    capabilities: string[];
    reason: string | null;
  }[];
  campaigns: {
    id: string;
    slots: { id: string; title: string; issues: string[]; ready: boolean }[];
  }[];
}) {
  const router = useRouter(),
    tab = useSearchParams().get("tab") ?? "content",
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [freshDefault] = useState(() =>
      new Date(Date.now() + 86400000).toISOString(),
    );
  const entities = (kind: string) =>
      state.entities.filter((e) => e.kind === kind),
    options = (kind: string): Option[] =>
      entities(kind).map((e) => ({
        value: e.id,
        label: `${String(e.data.title ?? e.data.name ?? e.data.text ?? e.data.platform ?? e.kind).slice(0, 70)} · ${String(e.data.status ?? e.data.content_state ?? "")} · v${e.version}`,
      }));
  const platformOptions = accounts.map((a) => ({
    value: a.platform,
    label: a.platform,
  }));
  async function send(command: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ epoch: state.epoch, command }),
        }),
        body = await r.json();
      if (!r.ok) throw Error(body.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setBusy(false);
    }
  }
  const text = (f: FormData, key: string) => String(f.get(key) ?? ""),
    list = (f: FormData, key: string) =>
      text(f, key)
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
  const card = (e: Entity, children?: ReactNode) => (
    <article className="control-card" key={e.id}>
      <div className="eyebrow">
        {e.kind} · v{e.version} {e.is_demo && "· DEMO"}
      </div>
      <h3>
        {String(
          e.data.title ??
            e.data.name ??
            e.data.text ??
            e.data.platform ??
            e.kind,
        )}
      </h3>
      <p>{String(e.data.status ?? e.data.content_state ?? "")}</p>
      {typeof e.data.provenance === "string" && <p>{e.data.provenance}</p>}
      {children}
    </article>
  );
  return (
    <>
      <header>
        <span className="eyebrow">
          CONTENT CONTROL PLANE / REVISION {state.epoch}
        </span>
        <h1>Content Workbench</h1>
        <p>
          Human decisions, exact revisions, real dependencies. External
          publishing is disabled.
        </p>
        <Link href="/actions">My Actions</Link>
      </header>
      <nav className="tabs control-tabs" aria-label="Workbench sections">
        {[
          "content",
          "brand",
          "ideas",
          "takes",
          "graphics",
          "launch",
          "accounts",
          "newsletter",
          "analytics",
          "public",
          "operations",
        ].map((t) => (
          <Link
            href={`/workbench?tab=${t}`}
            className={tab === t ? "selected" : ""}
            key={t}
          >
            {t}
          </Link>
        ))}
      </nav>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="control-grid">
        {tab === "brand" && (
          <>
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="New brand revision"
              build={(f) => ({
                action: "brand_save",
                banned_patterns: list(f, "banned_patterns"),
                name: text(f, "name"),
                positioning: text(f, "positioning"),
                audience: text(f, "audience"),
                pillars: list(f, "pillars"),
                tone: list(f, "tone"),
                cta: text(f, "cta"),
              })}
            >
              <Field name="name" label="Name" value="Daniel Rodriguez" />
              <Field name="positioning" label="Positioning" multiline />
              <Field name="audience" label="Audience" />
              <Field name="pillars" label="Pillars, one per line" multiline />
              <Field
                name="tone"
                label="Tone principles, one per line"
                multiline
              />
              <Field name="cta" label="Preferred CTA" />
              <Field
                name="banned_patterns"
                label="Banned voice patterns, one regular expression per line (optional)"
                multiline
                optional
              />
            </Form>
            {entities("brand").map((e) =>
              card(
                e,
                <>
                  <p>{String(e.data.positioning)}</p>
                  <p>{String(e.data.audience)}</p>
                  {e.data.status === "draft" && (
                    <Form
                      send={send}
                      busy={busy}
                      setError={setError}
                      title="Approve brand revision"
                      label="Approve"
                      confirm
                      build={() => ({ action: "brand_approve", id: e.id })}
                    />
                  )}
                </>,
              ),
            )}
          </>
        )}
        {tab === "ideas" && (
          <>
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Capture an idea"
              build={(f) => ({
                action: "idea_create",
                title: text(f, "title"),
                source: text(f, "source"),
                ...(text(f, "story_id")
                  ? { story_id: text(f, "story_id") }
                  : {}),
                provenance: text(f, "provenance"),
                originality: text(f, "originality"),
              })}
            >
              <Field name="title" label="Idea" />
              <Field
                name="source"
                label="Origin"
                options={[
                  "story",
                  "manual",
                  "build",
                  "audience",
                  "competitor",
                  "experiment",
                  "analytics",
                ].map((v) => ({ value: v, label: v }))}
              />
              <Field
                name="story_id"
                label="Story"
                optional
                options={[
                  { value: "", label: "Independent idea" },
                  ...stories.map((s) => ({ value: s.id, label: s.title })),
                ]}
              />
              <Field
                name="provenance"
                label="Evidence / observation / origin"
                multiline
              />
              <Field
                name="originality"
                label="Original contribution (required for competitor ideas)"
                multiline
                optional
              />
            </Form>
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Audience question with consent"
              confirm
              build={(f) => ({
                action: "question_create",
                text: text(f, "text"),
                source: text(f, "source"),
                consent: true,
              })}
            >
              <Field name="text" label="Question" multiline />
              <Field name="source" label="Where it came from" />
            </Form>
            {entities("idea").map((e) =>
              card(
                e,
                <Form
                  send={send}
                  busy={busy}
                  setError={setError}
                  title="Move idea"
                  build={(f) => ({
                    action: "idea_transition",
                    id: e.id,
                    target: text(f, "target"),
                  })}
                >
                  <Field
                    name="target"
                    label="Next state"
                    options={["qualified", "selected", "archived"].map((v) => ({
                      value: v,
                      label: v,
                    }))}
                  />
                </Form>,
              ),
            )}
          </>
        )}
        {tab === "takes" && (
          <>
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Propose a take for human review"
              build={(f) => ({
                action: "take_suggest",
                text: text(f, "text"),
                topic: text(f, "topic"),
                rationale: text(f, "rationale"),
                source_ids: [],
              })}
            >
              <Field
                name="text"
                label="Suggested thesis; not Daniel's opinion"
                multiline
              />
              <Field name="topic" label="Topic" />
              <Field name="rationale" label="Rationale" multiline />
            </Form>
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Editorially reject a story"
              confirm
              build={(f) => ({
                action: "story_reject",
                story_id: text(f, "story_id"),
                reason: text(f, "reason"),
              })}
            >
              <Field
                name="story_id"
                label="Story"
                options={stories.map((s) => ({ value: s.id, label: s.title }))}
              />
              <Field
                name="reason"
                label="Editorial reason; not a system failure"
                multiline
              />
            </Form>
            {entities("take").map((e) =>
              card(
                e,
                <>
                  <p>{String(e.data.rationale)}</p>
                  {["suggested", "approved"].includes(
                    String(e.data.status),
                  ) && (
                    <Form
                      send={send}
                      busy={busy}
                      setError={setError}
                      title="Human take decision"
                      confirm
                      build={(f) => ({
                        action: "take_decide",
                        id: e.id,
                        decision: text(f, "decision"),
                        reason: text(f, "reason"),
                      })}
                    >
                      <Field
                        name="decision"
                        label="Decision"
                        options={(e.data.status === "approved"
                          ? ["superseded"]
                          : ["approved", "rejected"]
                        ).map((v) => ({ value: v, label: v }))}
                      />
                      <Field name="reason" label="Reason" multiline />
                    </Form>
                  )}
                </>,
              ),
            )}
            {entities("decision").map((e) =>
              card(e, <p>{String(e.data.reason)}</p>),
            )}
          </>
        )}
        {tab === "content" && (
          <>
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Plan a selected idea"
              build={(f) => ({
                action: "content_create",
                idea_id: text(f, "idea_id"),
                platform: text(f, "platform"),
                format: text(f, "format"),
                purpose: text(f, "purpose"),
              })}
            >
              <Field
                name="idea_id"
                label="Selected idea"
                options={options("idea")}
              />
              <Field
                name="platform"
                label="Platform"
                options={platformOptions}
              />
              <Field
                name="format"
                label="Format"
                options={[
                  "video",
                  "post",
                  "thread",
                  "carousel",
                  "newsletter",
                ].map((v) => ({ value: v, label: v }))}
              />
              <Field name="purpose" label="Audience purpose" multiline />
            </Form>
            {entities("content").map((e) => {
              const c = e as unknown as Entity<Content>,
                s = stories.find((s) => s.id === e.story_id),
                packages = entities("package").filter(
                  (p) => p.parent_id === c.id,
                );
              return card(
                e,
                <>
                  <p>
                    {c.data.platform} / {c.data.format} / {c.data.language}
                  </p>
                  <p>
                    Production: {c.data.production_state} · Distribution:{" "}
                    {c.data.distribution_state} · Analytics:{" "}
                    {c.data.analytics_state}
                  </p>
                  {s && (
                    <Link href={`/stories/${s.id}?tab=drafts`}>
                      Story evidence and script revisions
                    </Link>
                  )}
                  <Form
                    send={send}
                    busy={busy}
                    setError={setError}
                    title="Bind exact draft revision"
                    build={(f) => ({
                      action: "content_bind",
                      id: c.id,
                      draft_id: text(f, "draft_id"),
                      ...(text(f, "production_id")
                        ? { production_id: text(f, "production_id") }
                        : {}),
                    })}
                  >
                    <Field
                      name="draft_id"
                      label="Script"
                      options={
                        s?.drafts.map((d) => ({
                          value: d.id,
                          label: `r${d.revision} · ${d.status} · ${d.hook.slice(0, 50)}`,
                        })) ?? []
                      }
                    />
                    <Field
                      name="production_id"
                      label="Recording package"
                      optional
                      options={[
                        { value: "", label: "Not required / not yet created" },
                        ...production.packages
                          .filter((p) => p.story_id === e.story_id)
                          .map((p) => ({
                            value: p.id,
                            label: `${p.data.title} · ${p.data.state} · v${p.version}`,
                          })),
                      ]}
                    />
                  </Form>
                  <Form
                    send={send}
                    busy={busy}
                    setError={setError}
                    title="Freshness classification"
                    confirm
                    build={(f) => ({
                      action: "content_freshness",
                      id: c.id,
                      evergreen: text(f, "evergreen") === "true",
                      fresh_until:
                        text(f, "evergreen") === "true"
                          ? null
                          : new Date(text(f, "fresh_until")).toISOString(),
                    })}
                  >
                    <Field
                      name="evergreen"
                      label="Classification"
                      options={[
                        { value: "false", label: "Time-sensitive news" },
                        { value: "true", label: "Evergreen, human-confirmed" },
                      ]}
                    />
                    <Field
                      name="fresh_until"
                      label="Fresh until (date and time)"
                      optional
                      value={freshDefault}
                    />
                  </Form>
                  {s && (
                    <Form
                      send={send}
                      busy={busy}
                      setError={setError}
                      title="Revalidate current claims"
                      confirm
                      build={(f) => ({
                        action: "claim_revalidate",
                        id: c.id,
                        source_ids: s.sources.map((s) => s.id),
                        notes: text(f, "notes"),
                      })}
                    >
                      <Field
                        name="notes"
                        label="What was checked against retained evidence"
                        multiline
                      />
                    </Form>
                  )}
                  <Form
                    send={send}
                    busy={busy}
                    setError={setError}
                    title="Content decision"
                    confirm
                    build={(f) => ({
                      action: "content_transition",
                      id: c.id,
                      target: text(f, "target"),
                    })}
                  >
                    <Field
                      name="target"
                      label="Next state"
                      options={[
                        "drafting",
                        "draft_ready",
                        "review",
                        "approved",
                        "rejected",
                        "archived",
                      ].map((v) => ({ value: v, label: v }))}
                    />
                  </Form>
                  <Form
                    send={send}
                    busy={busy}
                    setError={setError}
                    title="Attach approved take"
                    build={(f) => ({
                      action: "content_take",
                      id: c.id,
                      take_id: text(f, "take_id"),
                    })}
                  >
                    <Field
                      name="take_id"
                      label="Take"
                      options={options("take")}
                    />
                  </Form>
                  {c.data.quality_issues.length > 0 && (
                    <div>
                      <h4>Voice quality warnings</h4>
                      {c.data.quality_issues.map((i, n) => (
                        <p key={n}>
                          {i.severity}: “{i.excerpt}” — {i.remediation}
                        </p>
                      ))}
                    </div>
                  )}
                  <Form
                    send={send}
                    busy={busy}
                    setError={setError}
                    title="Create a platform package"
                    build={(f) => ({
                      action: "package_create",
                      ...(text(f, "privacy")
                        ? { privacy: text(f, "privacy") }
                        : {}),
                      id: c.id,
                      caption: text(f, "caption"),
                      title: text(f, "title"),
                      cta: text(f, "cta"),
                      thread: list(f, "thread"),
                      graphic_ids: text(f, "graphic")
                        ? [text(f, "graphic")]
                        : [],
                    })}
                  >
                    {["tiktok", "youtube"].includes(c.data.platform) && (
                      <Field
                        name="privacy"
                        label="Visibilidad elegida por Daniel"
                        options={(c.data.platform === "tiktok"
                          ? [
                              "PUBLIC_TO_EVERYONE",
                              "MUTUAL_FOLLOW_FRIENDS",
                              "FOLLOWER_OF_CREATOR",
                              "SELF_ONLY",
                            ]
                          : ["public", "unlisted", "private"]
                        ).map((value) => ({ value, label: value }))}
                      />
                    )}
                    <Field name="title" label="Platform title / hook" />
                    <Field
                      name="caption"
                      label="Platform-specific copy"
                      multiline
                    />
                    <Field name="cta" label="CTA" optional />
                    <Field
                      name="thread"
                      label="X thread, ordered posts one per line"
                      optional
                      multiline
                    />
                    <Field
                      name="graphic"
                      label="Cover / carousel / graphic"
                      optional
                      options={[
                        { value: "", label: "No graphic" },
                        ...options("graphic").filter((o) =>
                          entities("graphic").some(
                            (g) => g.id === o.value && g.parent_id === c.id,
                          ),
                        ),
                      ]}
                    />
                  </Form>
                  {packages.map((p) => {
                    const data = p.data as unknown as Package;
                    return (
                      <section key={p.id}>
                        <h4>
                          {data.platform} package v{p.version} · {data.status}
                        </h4>
                        <p className="preserve-lines">{data.caption}</p>
                        {data.thread.map((t, i) => (
                          <p key={i}>
                            {i + 1}. {t}
                          </p>
                        ))}
                        {data.status === "draft" && (
                          <Form
                            send={send}
                            busy={busy}
                            setError={setError}
                            title="Approve exact platform copy"
                            confirm
                            build={() => ({
                              action: "package_approve",
                              id: p.id,
                            })}
                          />
                        )}
                        <Form
                          send={send}
                          busy={busy}
                          setError={setError}
                          title="Final content approval"
                          confirm
                          build={() => ({
                            action: "content_final",
                            id: c.id,
                            package_id: p.id,
                          })}
                        />
                        <Form
                          send={send}
                          busy={busy}
                          setError={setError}
                          title="Prepare distribution job (external sends disabled)"
                          confirm
                          build={() => ({
                            action: "distribution_queue",
                            package_id: p.id,
                            due_at: new Date().toISOString(),
                          })}
                        />
                        {!p.is_demo && (
                          <Form
                            send={send}
                            busy={busy}
                            setError={setError}
                            title="Record an already published manual post"
                            confirm
                            build={(f) => ({
                              action: "publication_record",
                              package_id: p.id,
                              url: text(f, "url"),
                              published_at: new Date(
                                text(f, "published_at"),
                              ).toISOString(),
                            })}
                          >
                            <Field name="url" label="Actual publication URL" />
                            <Field
                              name="published_at"
                              label="Actual publication timestamp"
                            />
                          </Form>
                        )}
                        {p.is_demo && (
                          <Form
                            send={send}
                            busy={busy}
                            setError={setError}
                            title="Simulate publication in demo only"
                            confirm
                            build={() => ({
                              action: "publication_demo",
                              package_id: p.id,
                            })}
                          />
                        )}
                      </section>
                    );
                  })}
                </>,
              );
            })}
          </>
        )}
        {tab === "graphics" && (
          <>
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Queue a graphic / carousel render"
              build={(f) => ({
                action: "graphic_queue",
                content_id: text(f, "content_id"),
                template: text(f, "template"),
                aspect: text(f, "aspect"),
                headline: text(f, "headline"),
                text: text(f, "text"),
                source_ids: [
                  text(f, "source_id"),
                  text(f, "second_source_id"),
                ].filter(Boolean),
                slides: list(f, "slides").map((line) => {
                  const [headline, ...body] = line.split("|");
                  return {
                    headline: headline.trim(),
                    body: body.join("|").trim(),
                  };
                }),
              })}
            >
              <Field
                name="content_id"
                label="Content"
                options={options("content")}
              />
              <Field
                name="template"
                label="Template"
                options={[
                  "source",
                  "stat",
                  "comparison",
                  "quote",
                  "news",
                  "carousel_title",
                  "carousel_body",
                  "build_result",
                  "cover",
                ].map((v) => ({ value: v, label: v }))}
              />
              <Field
                name="aspect"
                label="Aspect"
                options={["9:16", "1:1", "4:5", "16:9"].map((v) => ({
                  value: v,
                  label: v,
                }))}
              />
              <Field name="headline" label="Headline" />
              <Field
                name="text"
                label="Body / exact quote or stat excerpt"
                optional
                multiline
              />
              <Field
                name="source_id"
                label="Source"
                options={stories.flatMap((s) =>
                  s.sources.map((source) => ({
                    value: source.id,
                    label: `${s.title.slice(0, 35)} · ${source.publisher}`,
                  })),
                )}
              />
              <Field
                name="second_source_id"
                label="Second source for comparison"
                optional
                options={[
                  { value: "", label: "None" },
                  ...stories.flatMap((s) =>
                    s.sources.map((source) => ({
                      value: source.id,
                      label: source.publisher,
                    })),
                  ),
                ]}
              />
              <Field
                name="slides"
                label="Carousel slides, one headline | body per line"
                optional
                multiline
              />
            </Form>
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Process queued graphics"
              build={() => ({ action: "graphics_process" })}
              label="Render now"
            />
            {entities("graphic").map((e) =>
              card(
                e,
                <>
                  {Array.isArray(e.data.outputs) &&
                    (e.data.outputs as unknown[]).map((_, i) => (
                      <p key={i}>
                        <a href={`/api/control/graphics/${e.id}?slide=${i}`}>
                          Download slide {i + 1} (SVG)
                        </a>
                        <a
                          href={`/api/control/graphics/${e.id}?slide=${i}&format=png`}
                        >
                          Download slide {i + 1} (PNG)
                        </a>
                      </p>
                    ))}
                  <p>
                    Rights: {String(e.data.rights)} · draft r
                    {String(e.data.content_revision)}
                  </p>
                  {e.data.status === "rendered" && (
                    <Form
                      send={send}
                      busy={busy}
                      setError={setError}
                      title="Review asset clearance"
                      confirm
                      build={(f) => ({
                        action: "graphic_clear",
                        id: e.id,
                        basis: text(f, "basis"),
                        scope: text(f, "scope"),
                      })}
                    >
                      <Field
                        name="basis"
                        label="Documented usage / ownership basis"
                        multiline
                      />
                      <Field
                        name="scope"
                        label="Permitted platform scope"
                        options={platformOptions}
                      />
                    </Form>
                  )}
                </>,
              ),
            )}
          </>
        )}
        {tab === "launch" && (
          <>
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Create launch campaign"
              build={(f) => ({
                action: "campaign_create",
                name: text(f, "name"),
                content_ids: f.getAll("content_ids").map(String),
              })}
            >
              <Field name="name" label="Campaign name" />
              {options("content").map((o) => (
                <label className="consent" key={o.value}>
                  <input type="checkbox" name="content_ids" value={o.value} />
                  {o.label}
                </label>
              ))}
            </Form>
            {campaigns.map((c) => (
              <article className="control-card" key={c.id}>
                <h3>
                  {String(
                    entities("campaign").find((e) => e.id === c.id)?.data.name,
                  )}
                </h3>
                {c.slots.map((s) => (
                  <section key={s.id}>
                    <h4>
                      {s.title} · {s.ready ? "READY" : "BLOCKED"}
                    </h4>
                    <ul>
                      {s.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </article>
            ))}
          </>
        )}
        {tab === "accounts" && (
          <>
            {accounts.map((a) => (
              <article className="control-card" key={a.platform}>
                <h3>{a.platform}</h3>
                <p>{a.status.toUpperCase()}</p>
                <p>{a.reason}</p>
                <p>
                  Verified capabilities: {a.capabilities.join(", ") || "none"}
                </p>
                <Form
                  send={send}
                  busy={busy}
                  setError={setError}
                  title="Account created externally"
                  build={(f) => ({
                    action: "account_create",
                    platform: a.platform,
                    handle: text(f, "handle"),
                  })}
                >
                  <Field
                    name="handle"
                    label="Your existing account handle / URL"
                    value={a.handle}
                  />
                </Form>
                {a.id && (
                  <Form
                    send={send}
                    busy={busy}
                    setError={setError}
                    title="Revoke registry connection"
                    confirm
                    build={() => ({ action: "account_revoke", id: a.id })}
                  />
                )}
              </article>
            ))}
          </>
        )}
        {tab === "newsletter" && (
          <>
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Compose issue from approved sections"
              build={(f) => ({
                action: "newsletter_create",
                title: text(f, "title"),
                opening: text(f, "opening"),
                package_ids: f.getAll("package_ids").map(String),
              })}
            >
              <Field name="title" label="Issue title" />
              <Field
                name="opening"
                label="Opening note written by Daniel"
                optional
                multiline
              />
              {entities("package")
                .filter(
                  (p) =>
                    p.data.platform === "beehiiv" &&
                    p.data.status === "approved",
                )
                .map((p) => (
                  <label className="consent" key={p.id}>
                    <input name="package_ids" type="checkbox" value={p.id} />
                    {String(p.data.title)} · v{p.version}
                  </label>
                ))}
            </Form>
            {entities("newsletter").map((e) =>
              card(
                e,
                <>
                  <p>Exact issue revision {String(e.data.revision)}</p>
                  <p>{String(e.data.opening)}</p>
                  <Form
                    send={send}
                    busy={busy}
                    setError={setError}
                    title="New issue revision"
                    build={(f) => ({
                      action: "newsletter_revise",
                      id: e.id,
                      title: text(f, "title"),
                      opening: text(f, "opening"),
                    })}
                  >
                    <Field
                      name="title"
                      label="Title"
                      value={String(e.data.title)}
                    />
                    <Field
                      name="opening"
                      label="Opening"
                      optional
                      multiline
                      value={String(e.data.opening)}
                    />
                  </Form>
                  {e.data.status === "drafting" && (
                    <Form
                      send={send}
                      busy={busy}
                      setError={setError}
                      title="Send issue to review"
                      build={() => ({ action: "newsletter_review", id: e.id })}
                    />
                  )}{" "}
                  {e.data.status === "review" && (
                    <Form
                      send={send}
                      busy={busy}
                      setError={setError}
                      title="Approve exact issue revision"
                      confirm
                      build={() => ({ action: "newsletter_approve", id: e.id })}
                    />
                  )}
                  <p>
                    beehiiv: {String(e.data.provider_state)} · no emails sent
                  </p>
                </>,
              ),
            )}
          </>
        )}
        {tab === "analytics" && (
          <>
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Process due analytics jobs"
              build={() => ({ action: "analytics_process" })}
            />
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Record actual manually obtained metrics"
              confirm
              build={(f) => ({
                action: "metrics_record",
                publication_id: text(f, "publication_id"),
                metrics: {
                  views: Number(text(f, "views")),
                  likes: Number(text(f, "likes")),
                },
                raw: {
                  source: text(f, "source"),
                  views: text(f, "views"),
                  likes: text(f, "likes"),
                },
              })}
            >
              <Field
                name="publication_id"
                label="Publication"
                options={options("publication")}
              />
              <Field name="views" label="Observed views" />
              <Field name="likes" label="Observed likes" />
              <Field
                name="source"
                label="Provider report / observation provenance"
              />
            </Form>
            {entities("publication").map((e) =>
              card(
                e,
                <>
                  <p>
                    {e.data.simulated === true
                      ? "SIMULATED PUBLICATION"
                      : "Recorded publication"}
                  </p>
                  <p>{JSON.stringify(e.data.raw_snapshots)}</p>
                  <Form
                    send={send}
                    busy={busy}
                    setError={setError}
                    title="Review performance and create follow-up idea"
                    build={(f) => ({
                      action: "performance_review",
                      id: e.id,
                      notes: text(f, "notes"),
                    })}
                  >
                    <Field
                      name="notes"
                      label="Observed pattern and next question (no causality claim)"
                      multiline
                    />
                  </Form>
                </>,
              ),
            )}
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Register content experiment"
              build={(f) => ({
                action: "experiment_create",
                name: text(f, "name"),
                hypothesis: text(f, "hypothesis"),
                arms: list(f, "arms"),
                metric: text(f, "metric"),
              })}
            >
              <Field name="name" label="Name" />
              <Field name="hypothesis" label="Hypothesis" multiline />
              <Field name="arms" label="Arms, one per line" multiline />
              <Field name="metric" label="Measured metric" />
            </Form>
            {entities("experiment").map((e) =>
              card(
                e,
                <>
                  <p>{String(e.data.hypothesis)}</p>
                  <Form
                    send={send}
                    busy={busy}
                    setError={setError}
                    title="Assign content to an arm"
                    build={(f) => ({
                      action: "experiment_assign",
                      id: e.id,
                      content_id: text(f, "content_id"),
                      arm: text(f, "arm"),
                    })}
                  >
                    <Field
                      name="content_id"
                      label="Content"
                      options={options("content")}
                    />
                    <Field
                      name="arm"
                      label="Arm"
                      options={(e.data.arms as string[]).map((v) => ({
                        value: v,
                        label: v,
                      }))}
                    />
                  </Form>
                  <Form
                    send={send}
                    busy={busy}
                    setError={setError}
                    title="Human experiment review"
                    confirm
                    build={(f) => ({
                      action: "experiment_review",
                      id: e.id,
                      notes: text(f, "notes"),
                    })}
                  >
                    <Field
                      name="notes"
                      label="Observations and limitations"
                      multiline
                    />
                  </Form>
                </>,
              ),
            )}
          </>
        )}
        {tab === "public" && (
          <>
            <p>
              Only the following explicitly approved text is copied to the
              public read model. Drafts, notes, tokens, analytics and Drive
              references are never queried by the public site.
            </p>
            <Link href="/about">Open public site</Link>
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Approve a canonical link"
              confirm
              build={(f) => ({
                action: "link_create",
                title: text(f, "title"),
                url: text(f, "url"),
              })}
            >
              <Field name="title" label="Label" />
              <Field name="url" label="HTTPS URL" />
            </Form>
            <Form
              send={send}
              busy={busy}
              setError={setError}
              title="Materialize approved public copy"
              confirm
              build={(f) => ({
                action: "materialize_public",
                id: text(f, "id"),
                kind: text(f, "kind"),
                title: text(f, "title"),
                description: text(f, "description"),
                body: text(f, "body"),
                url: text(f, "url") || null,
              })}
            >
              <Field
                name="id"
                label="Approved source"
                options={[
                  ...options("brand"),
                  ...options("content"),
                  ...options("link"),
                ]}
              />
              <Field
                name="kind"
                label="Public section"
                options={["profile", "build", "content", "link"].map((v) => ({
                  value: v,
                  label: v,
                }))}
              />
              <Field name="title" label="Public title" />
              <Field
                name="description"
                label="Public description"
                multiline
                optional
              />
              <Field
                name="body"
                label="Explicit public body; no private notes"
                multiline
                optional
              />
              <Field
                name="url"
                label="Public HTTPS link (never Drive internals)"
                optional
              />
            </Form>
          </>
        )}
        {tab === "operations" && (
          <>
            <article className="control-card">
              <h3>Runtime health</h3>
              <Form
                send={send}
                busy={busy}
                setError={setError}
                title="Validate due distribution jobs; no sends"
                build={() => ({ action: "distribution_process" })}
              />
              <a href="/api/control/health">
                Run authenticated live health check
              </a>
              <p>
                Worker protocol 1 · {state.workers.length} registered worker(s)
              </p>
              {state.workers.map((w) => (
                <p key={w.id}>
                  {w.id} · {w.version} · {w.last_seen} ·{" "}
                  {w.active_job ?? "idle"}
                </p>
              ))}
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  const r = await fetch("/api/control/export", {
                    method: "POST",
                  });
                  if (!r.ok) {
                    setError("Export failed");
                    return;
                  }
                  const url = URL.createObjectURL(await r.blob()),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = "brainos-project.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download private portable backup
              </button>
            </article>
            {state.jobs.map((j) => (
              <article className="control-card" key={j.id}>
                <h3>
                  {j.kind} · {j.status}
                </h3>
                <p>
                  Due {j.due_at} · attempts {j.attempts ?? 0}
                </p>
                <p>{j.error}</p>
                {["blocked", "failed", "dead_letter"].includes(j.status) && (
                  <Form
                    send={send}
                    busy={busy}
                    setError={setError}
                    title="Retry after resolving cause"
                    build={() => ({ action: "job_retry", id: j.id })}
                  />
                )}{" "}
                {j.status === "queued" && (
                  <Form
                    send={send}
                    busy={busy}
                    setError={setError}
                    title="Cancel queued work"
                    build={() => ({ action: "job_cancel", id: j.id })}
                  />
                )}
              </article>
            ))}
            <article className="control-card">
              <h3>Recent audit events</h3>
              {state.events.slice(0, 20).map((e) => (
                <p key={e.id}>
                  {e.kind} · {e.actor} · {e.created_at}
                </p>
              ))}
            </article>
          </>
        )}
      </div>
    </>
  );
}
