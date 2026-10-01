import Link from "next/link";
import {
  ExternalLink,
  Check,
  LockKeyhole,
  AlertCircle,
  Quote,
  FileText,
} from "lucide-react";
import { CommandForm } from "./actions";
import { DateText, Empty, LevelChip, Status } from "./ui";
import {
  activeDraft,
  approvalIssues,
  clearanceIssues,
} from "@/domain/workflow";
import { platformLabels, type Story, type Draft } from "@/domain/types";
function Action({
  story,
  command,
  label,
  children,
  arrays,
  variant,
}: {
  story: Story;
  command: Parameters<typeof CommandForm>[0]["command"];
  label: string;
  children?: React.ReactNode;
  arrays?: string[];
  variant?: string;
}) {
  return (
    <CommandForm
      key={`${story.version}-${command.type}-${String(command.draftId ?? "")}`}
      storyId={story.id}
      version={story.version}
      command={command}
      label={label}
      arrays={arrays}
      variant={variant}
    >
      {children}
    </CommandForm>
  );
}
export function Sources({ story }: { story: Story }) {
  return (
    <div className="panel-stack">
      {story.sources.map((s) => (
        <article className="panel source-panel" key={s.id}>
          <div className="section-heading">
            <span className="tag">{s.tier.toUpperCase()} SOURCE</span>
            <a
              className="text-link"
              href={s.url}
              target="_blank"
              rel="noreferrer"
            >
              Open original <ExternalLink size={14} />
            </a>
          </div>
          <h3>{s.title}</h3>
          <div className="inline-meta">
            <strong>{s.publisher}</strong>
            <span>{s.author}</span>
            <span>{s.type}</span>
          </div>
          <blockquote>{s.excerpt}</blockquote>
          <dl className="metadata">
            <div>
              <dt>Original URL</dt>
              <dd>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.url}
                </a>
              </dd>
            </div>
            <div>
              <dt>Canonical URL</dt>
              <dd>{s.canonical_url}</dd>
            </div>
            <div>
              <dt>Source publication</dt>
              <dd>
                <DateText value={s.published_at} />
              </dd>
            </div>
            <div>
              <dt>{story.is_demo ? "Fixture recorded" : "Retrieved"}</dt>
              <dd>
                <DateText value={s.retrieved_at} />
              </dd>
            </div>
            {story.discovery?.source_times?.[s.id] && (
              <>
                <div>
                  <dt>Feed updated</dt>
                  <dd>
                    <DateText
                      value={story.discovery.source_times[s.id].updated_at}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Timestamp basis</dt>
                  <dd>{story.discovery.source_times[s.id].timestamp_note}</dd>
                </div>
                <div>
                  <dt>Original timestamp</dt>
                  <dd>
                    {story.discovery.source_times[s.id].original_timestamp ??
                      "Not supplied"}
                  </dd>
                </div>
                <div>
                  <dt>Evidence hash</dt>
                  <dd>{story.discovery.source_times[s.id].content_hash}</dd>
                </div>
              </>
            )}
            <div>
              <dt>Reliability / limits</dt>
              <dd>{s.reliability}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}
export function Claims({
  story,
  compact = false,
}: {
  story: Story;
  compact?: boolean;
}) {
  return (
    <div className="panel-stack">
      {story.claims.map((c, i) => (
        <article className="panel claim-panel" key={c.id}>
          <div className="section-heading">
            <span className="small-cap">
              CLAIM {String(i + 1).padStart(2, "0")}
            </span>
            <span
              className={`rights rights-${c.verification_status === "supported" ? "cleared" : "unknown"}`}
            >
              {c.verification_status}
            </span>
          </div>
          <h3>{c.text}</h3>
          <p className="subtle">
            Confidence: <LevelChip value={c.confidence} /> · {c.notes}
          </p>
          {story.evidence
            .filter((e) => e.claim_id === c.id)
            .map((e) => {
              const source = story.sources.find((s) => s.id === e.source_id);
              return (
                <div className="evidence" key={e.id}>
                  <div className="small-cap">
                    <Quote size={13} />
                    SUPPORTING EVIDENCE
                  </div>
                  <blockquote>{e.excerpt}</blockquote>
                  <div className="inline-meta">
                    <a href={source?.url} target="_blank" rel="noreferrer">
                      {source?.publisher}
                      <ExternalLink size={12} />
                    </a>
                    <span>{e.locator}</span>
                  </div>
                </div>
              );
            })}
          {!compact && (
            <details className="edit-disclosure">
              <summary>Record a human evidence check</summary>
              <Action
                story={story}
                command={{ type: "verify_claim", claimId: c.id }}
                label="Save evidence check"
              >
                <label>
                  Verification
                  <select
                    name="verification"
                    defaultValue={c.verification_status}
                  >
                    <option value="unverified">Unverified</option>
                    <option value="supported">
                      Supported by the linked excerpt
                    </option>
                    <option value="conflicting">Conflicting</option>
                  </select>
                </label>
                <label>
                  Verification notes
                  <textarea name="notes" required defaultValue={c.notes} />
                </label>
                <p className="subtle">
                  Changing evidence invalidates existing approval and requires
                  research confirmation.
                </p>
              </Action>
            </details>
          )}
        </article>
      ))}
    </div>
  );
}
export function Research({ story }: { story: Story }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Research notebook</h2>
        <span className="tag">HUMAN REVIEW</span>
      </div>
      <Action
        story={story}
        command={{ type: "research" }}
        label="Save research notes"
      >
        <label>
          Structured notes
          <textarea
            rows={12}
            name="notes"
            required
            defaultValue={story.research_notes}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            name="confirmed"
            defaultChecked={story.research_confirmed}
          />
          I checked the source evidence and separated assumptions from facts.
        </label>
        <p className="subtle">
          Saving revised research invalidates prior approval. Demo notes do not
          establish external facts.
        </p>
      </Action>
      <div className="note-grid">
        <div>
          <span className="small-cap">WHY IT MATTERS · ANALYSIS</span>
          <p>{story.why_matters}</p>
        </div>
        <div>
          <span className="small-cap">LATAM · HYPOTHESIS</span>
          <p>{story.latam_reason}</p>
        </div>
      </div>
    </section>
  );
}
export function Angles({ story }: { story: Story }) {
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Find the point of view.</h2>
          <p className="subtle">
            Suggestions are possibilities. Only you can make them yours.
          </p>
        </div>
        <Action
          story={story}
          command={{ type: "suggest_angles" }}
          label="Suggest 3 angles"
          variant="quiet"
        />
      </div>
      <div className="angle-grid">
        {story.discovery?.suggestions?.map((suggestion) => (
          <article className="panel angle-card" key={suggestion.kind}>
            <span className="tag">
              {suggestion.kind.replaceAll("_", " ")} · SYSTEM SUGGESTION
            </span>
            <h3>{suggestion.text}</h3>
            <p className="subtle">
              An editorial prompt, not Daniel’s confirmed opinion. Write and
              explicitly approve an angle before drafting.
            </p>
            <div className="provenance">{suggestion.provenance}</div>
          </article>
        ))}
        {story.angles.map((a) => (
          <article className="panel angle-card" key={a.id}>
            <div className="inline-meta">
              <span className="tag">
                {a.kind.replace("_", " ").toUpperCase()}
              </span>
              <span
                className={`rights rights-${a.approval_state === "approved" ? "cleared" : "unknown"}`}
              >
                {a.approval_state === "approved"
                  ? "Approved by Daniel"
                  : a.created_by === "ai"
                    ? "AI suggestion"
                    : "Human-created"}
              </span>
            </div>
            <h3>“{a.text}”</h3>
            <p>{a.rationale}</p>
            <div className="provenance">
              {a.provenance} · <DateText value={a.created_at} />
            </div>
            {a.approval_state !== "approved" ? (
              <Action
                story={story}
                command={{ type: "approve_angle", angleId: a.id }}
                label="Approve this angle"
                variant="quiet"
              />
            ) : (
              <p className="confirmation">
                <Check size={15} />
                Confirmed for this story only
              </p>
            )}
          </article>
        ))}
      </div>
      <details className="panel">
        <summary>Write your own angle</summary>
        <Action
          story={story}
          command={{ type: "add_angle" }}
          label="Add human angle"
        >
          <label>
            Your angle
            <input name="text" required />
          </label>
          <label>
            Rationale
            <textarea name="rationale" required />
          </label>
        </Action>
      </details>
    </>
  );
}
export function DraftContent({ draft }: { draft: Draft }) {
  return (
    <div className="draft-copy">
      <span className="small-cap">HOOK</span>
      <h3>{draft.hook}</h3>
      <div className="script">{draft.body}</div>
      {draft.cta && (
        <div className="draft-cta">
          <span className="small-cap">CLOSE / CTA</span>
          <p>{draft.cta}</p>
        </div>
      )}
    </div>
  );
}
export function Drafts({ story }: { story: Story }) {
  const active = activeDraft(story);
  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <h2>Draft desk</h2>
          <span className="tag">ES PRIMARY</span>
        </div>
        <Action
          story={story}
          command={{ type: "generate_draft" }}
          label="Generate demo draft"
        >
          <div className="form-columns">
            <label>
              Approved angle
              <select
                name="angleId"
                required
                defaultValue={
                  story.angles.find((a) => a.approval_state === "approved")
                    ?.id ?? ""
                }
              >
                <option value="" disabled>
                  Choose an approved angle
                </option>
                {story.angles
                  .filter((a) => a.approval_state === "approved")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.text}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Target format
              <select name="platform">
                <option value="short_video">Short-video outline</option>
                <option value="instagram">Instagram / news card</option>
                <option value="x">X post</option>
                <option value="newsletter">Newsletter note</option>
              </select>
            </label>
          </div>
          <p className="subtle">
            Deterministic demo generation. No paid AI call; every output starts
            unapproved.
          </p>
        </Action>
      </section>
      {active && (
        <section className="panel draft-editor">
          <div className="section-heading">
            <div>
              <span className="small-cap">ACTIVE REVISION</span>
              <h2>
                {platformLabels[active.platform]}{" "}
                <span className="revision">v{active.revision}</span>
              </h2>
            </div>
            <span
              className={`rights rights-${active.status === "approved" ? "cleared" : "unknown"}`}
            >
              {active.status.replace("_", " ")}
            </span>
          </div>
          <Action
            story={story}
            command={{ type: "edit_draft", draftId: active.id }}
            label="Save as new revision"
            arrays={["assetIds"]}
          >
            <label>
              Hook
              <input name="hook" required defaultValue={active.hook} />
            </label>
            <label>
              Body / script
              <textarea
                name="body"
                rows={12}
                required
                defaultValue={active.body}
              />
            </label>
            <label>
              CTA
              <input name="cta" defaultValue={active.cta} />
            </label>
            <label>
              Shot / B-roll notes
              <textarea
                name="shotNotes"
                rows={3}
                defaultValue={active.shot_notes}
              />
            </label>
            <fieldset>
              <legend>Assets selected for this revision</legend>
              {story.assets.map((a) => (
                <label className="check" key={a.id}>
                  <input
                    type="checkbox"
                    name="assetIds"
                    value={a.id}
                    defaultChecked={active.asset_ids.includes(a.id)}
                  />
                  {a.title}
                  <span className={`rights rights-${a.rights_status}`}>
                    {a.rights_status}
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="subtle">
              <LockKeyhole size={14} />
              Saving keeps the original intact and creates an unapproved
              revision. Existing internal schedules are cancelled.
            </p>
          </Action>
        </section>
      )}
      <section className="panel">
        <div className="section-heading">
          <h2>Revision history</h2>
          <span className="count">{story.drafts.length}</span>
        </div>
        {!story.drafts.length && (
          <Empty title="No drafts yet">
            Approve an angle and create your first draft above.
          </Empty>
        )}
        {[...story.drafts]
          .sort((a, b) => b.revision - a.revision)
          .map((d) => (
            <details className="revision-row" key={d.id}>
              <summary>
                <span>
                  <strong>
                    {platformLabels[d.platform]} · v{d.revision}
                  </strong>
                  <small>
                    {d.id === story.active_draft_id
                      ? "Active revision"
                      : "Preserved revision"}{" "}
                    · {d.provenance}
                  </small>
                </span>
                <span className="tag">{d.status.replace("_", " ")}</span>
              </summary>
              <DraftContent draft={d} />
              <p className="subtle">
                Revision ID: {d.id}
                <br />
                Created: <DateText value={d.created_at} />
                {d.approved_at && (
                  <>
                    <br />
                    Approval history: {d.approved_by} ·{" "}
                    <DateText value={d.approved_at} />
                  </>
                )}
              </p>
              {d.id !== story.active_draft_id &&
                !story.drafts.some(
                  (x) => x.platform === d.platform && x.revision > d.revision,
                ) && (
                  <Action
                    story={story}
                    command={{ type: "select_draft", draftId: d.id }}
                    label="Select for a new review"
                    variant="quiet"
                  />
                )}
            </details>
          ))}
      </section>
    </>
  );
}
export function Assets({ story }: { story: Story }) {
  return (
    <>
      <div className="notice">
        <LockKeyhole size={18} />
        <div>
          <strong>Publicly accessible does not mean publishable.</strong>
          <p>
            Clearance needs a documented usage basis. Discovery does not grant
            rights to real media.
          </p>
        </div>
      </div>
      <div className="asset-grid">
        {story.assets.map((a) => (
          <article className="panel asset-card" key={a.id}>
            <div className={`asset-placeholder asset-${a.rights_status}`}>
              <FileText size={30} />
              <span>REFERENCE / {a.type.toUpperCase()}</span>
            </div>
            <div className="section-heading">
              <h3>{a.title}</h3>
              <span className={`rights rights-${a.rights_status}`}>
                {a.rights_status}
              </span>
            </div>
            <dl className="metadata">
              <div>
                <dt>Publisher / creator</dt>
                <dd>{a.publisher}</dd>
              </div>
              <div>
                <dt>Original source</dt>
                <dd>
                  <a href={a.source_url} target="_blank" rel="noreferrer">
                    Open source <ExternalLink size={12} />
                  </a>
                </dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>{a.storage_url ?? "Reference only · no file stored"}</dd>
              </div>
              <div>
                <dt>Usage basis</dt>
                <dd>{a.usage_basis}</dd>
              </div>
              <div>
                <dt>Attribution</dt>
                <dd>{a.attribution || "None recorded"}</dd>
              </div>
              <div>
                <dt>Publishable</dt>
                <dd>
                  <strong>
                    {a.publishable ? "Yes · documented use only" : "No"}
                  </strong>
                </dd>
              </div>
            </dl>
            <details className="edit-disclosure">
              <summary>Review usage rights</summary>
              <Action
                story={story}
                command={{ type: "asset_rights", assetId: a.id }}
                label="Save rights decision"
              >
                <label>
                  Rights status
                  <select name="rights" defaultValue={a.rights_status}>
                    <option value="unknown">Unknown</option>
                    <option value="cleared">Cleared for this package</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </label>
                <label>
                  License / permission / intended use
                  <textarea
                    name="basis"
                    required
                    defaultValue={a.usage_basis}
                  />
                </label>
                <label>
                  Required attribution
                  <input name="attribution" defaultValue={a.attribution} />
                </label>
              </Action>
            </details>
          </article>
        ))}
      </div>
      <details className="panel">
        <summary>Save a visual reference</summary>
        <Action
          story={story}
          command={{ type: "add_asset" }}
          label="Save with unknown rights"
        >
          <div className="form-columns">
            <label>
              Asset title
              <input name="title" required />
            </label>
            <label>
              Type
              <input
                name="assetType"
                required
                placeholder="Screenshot, chart, video reference…"
              />
            </label>
          </div>
          <label>
            Original source URL
            <input name="sourceUrl" type="url" required />
          </label>
          <label>
            Publisher / creator
            <input name="publisher" required />
          </label>
        </Action>
      </details>
    </>
  );
}
export function ReviewPackage({ story }: { story: Story }) {
  const d = activeDraft(story);
  if (!d) return <Empty title="No active draft to review" />;
  const issues = approvalIssues(story, d),
    angle = story.angles.find((a) => a.id === d.angle_id);
  return (
    <>
      <div className="review-package-heading">
        <div>
          <span className="small-cap">
            {platformLabels[d.platform]} / REVISION {d.revision}
          </span>
          <h2>
            <Link href={`/stories/${story.id}`}>{story.title}</Link>
          </h2>
        </div>
        <Status value={story.status} />
      </div>
      <div className="review-layout">
        <section className="panel">
          <div className="section-heading">
            <h3>The exact copy</h3>
            <span className="revision">v{d.revision}</span>
          </div>
          <DraftContent draft={d} />
          <Link className="text-link" href={`/stories/${story.id}?tab=drafts`}>
            Edit in the draft desk
          </Link>
        </section>
        <div className="panel-stack">
          <section className="panel">
            <span className="small-cap">CHOSEN ANGLE</span>
            <h3>{angle?.text}</h3>
            <p className="subtle">
              {angle?.created_by === "ai"
                ? "AI-origin suggestion"
                : "Human-created"}{" "}
              ·{" "}
              {angle?.approval_state === "approved"
                ? "explicitly approved for this story"
                : "not approved"}
            </p>
            <span className="small-cap">SELECTED ASSETS</span>
            {d.asset_ids.length ? (
              d.asset_ids.map((id) => {
                const a = story.assets.find((a) => a.id === id);
                return (
                  <div className="asset-summary" key={id}>
                    <span>{a?.title ?? "Missing asset"}</span>
                    <span
                      className={`rights rights-${a?.rights_status ?? "unknown"}`}
                    >
                      {a?.rights_status ?? "missing"}
                    </span>
                  </div>
                );
              })
            ) : (
              <p>Text-only package. No asset rights required.</p>
            )}
            <p className="subtle">
              {clearanceIssues(story, d).length
                ? "Resolve rights before approval."
                : "Selected assets pass the recorded clearance checks."}
            </p>
          </section>
          <Claims story={story} compact />
        </div>
      </div>
      <section className="panel decision-panel">
        <div>
          <span className="small-cap">EDITORIAL DECISION</span>
          <h2>Your name goes on this.</h2>
          <p>
            Approve the exact revision after checking its claims, point of view
            and selected visuals.
          </p>
          {issues.length > 0 && (
            <div className="form-error" role="status">
              <strong>Approval blocked</strong>
              <ul>
                {issues.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <Action
          story={story}
          command={{ type: "approve", draftId: d.id }}
          label={`Approve exact revision v${d.revision}`}
        >
          <label className="check">
            <input
              type="checkbox"
              name="confirmed"
              required
              disabled={!!issues.length}
            />
            I reviewed this exact copy, its evidence, personal statements and
            asset usage.
          </label>
        </Action>
        <div className="review-alternatives">
          <details>
            <summary>Request changes</summary>
            <Action
              story={story}
              command={{ type: "request_changes", draftId: d.id }}
              label="Return to draft desk"
              variant="quiet"
            >
              <label>
                What needs changing?
                <textarea name="reason" required />
              </label>
            </Action>
          </details>
          <details>
            <summary>Return to research</summary>
            <Action
              story={story}
              command={{ type: "return_research" }}
              label="Reopen research"
              variant="quiet"
            >
              <label>
                Research question
                <textarea name="reason" required />
              </label>
            </Action>
          </details>
          <details>
            <summary>Reject this revision</summary>
            <Action
              story={story}
              command={{ type: "reject", draftId: d.id }}
              label="Reject revision"
              variant="danger"
            >
              <label>
                Reason
                <textarea name="reason" required />
              </label>
            </Action>
          </details>
        </div>
      </section>
    </>
  );
}
export function WorkflowStep({ story }: { story: Story }) {
  const next: Partial<Record<Story["status"], [Story["status"], string]>> = {
    detected: ["verified", "Mark verified"],
    verified: ["researched", "Complete research"],
    researched: ["angle_ready", "Confirm angle selection"],
    drafted: ["assets_cleared", "Check asset clearance"],
    assets_cleared: [
      activeDraft(story)?.platform === "short_video"
        ? "recording_needed"
        : "render_ready",
      "Move to production",
    ],
    recording_needed: ["review", "Send for review"],
    render_ready: ["review", "Send for review"],
  };
  const step = next[story.status];
  return (
    <div className="workflow-next">
      <div>
        <span className="small-cap">CURRENT STAGE</span>
        <Status value={story.status} />
      </div>
      {step ? (
        <Action
          story={story}
          command={{ type: "transition", target: step[0] }}
          label={step[1]}
        />
      ) : story.status === "angle_ready" ? (
        <Link className="button" href={`/stories/${story.id}?tab=drafts`}>
          Create a draft
        </Link>
      ) : story.status === "review" ? (
        <Link className="button" href="/review">
          Open review queue
        </Link>
      ) : story.status === "approved" || story.status === "scheduled" ? (
        <Link className="button" href="/publish">
          Open publishing queue
        </Link>
      ) : null}
    </div>
  );
}
export function Overview({ story }: { story: Story }) {
  return (
    <div className="overview-grid">
      <section className="panel">
        <span className="small-cap">THE STORY</span>
        <h2>{story.why_matters}</h2>
        <p>{story.summary}</p>
        <div className="note-grid">
          <div>
            <span className="small-cap">LATAM RELEVANCE</span>
            <p>{story.latam_reason}</p>
          </div>
          <div>
            <span className="small-cap">EDITORIAL PILLAR</span>
            <p>{story.pillar}</p>
          </div>
        </div>
        <div className="notice">
          <AlertCircle size={18} />
          <p>
            {story.is_demo
              ? "Demo scenario. Original source fixtures and approved demo revisions illustrate the workflow; they are not current news or real test results."
              : "Live discovery. Feed excerpts describe publisher statements, not independently verified results. Review each claim against its original evidence."}
          </p>
        </div>
      </section>
      <section className="panel">
        <h3>Story details</h3>
        <dl className="metadata">
          <div>
            <dt>Type</dt>
            <dd>{story.story_type}</dd>
          </div>
          <div>
            <dt>Language</dt>
            <dd>{story.primary_language.toUpperCase()}</dd>
          </div>
          <div>
            <dt>Discovered</dt>
            <dd>
              <DateText value={story.discovered_at} />
            </dd>
          </div>
          <div>
            <dt>Publication time</dt>
            <dd>
              <DateText value={story.published_at} />
            </dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>
              <LevelChip value={story.confidence} />
            </dd>
          </div>
          <div>
            <dt>Audience relevance</dt>
            <dd>
              <LevelChip value={story.audience_relevance} />
            </dd>
          </div>
          <div>
            <dt>LATAM relevance</dt>
            <dd>
              <LevelChip value={story.latam_relevance} />
            </dd>
          </div>
          <div>
            <dt>Commercial relevance</dt>
            <dd>
              <LevelChip value={story.commercial_relevance} />
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
export function Activity({ story }: { story: Story }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>The editorial record</h2>
        <span className="tag">APPEND-ONLY HISTORY</span>
      </div>
      <div className="timeline">
        {[...story.events]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((e) => (
            <article key={e.id}>
              <span className="timeline-dot" />
              <div className="inline-meta">
                <strong>{e.type.replaceAll("_", " ")}</strong>
                <span>
                  <DateText value={e.created_at} />
                </span>
              </div>
              <p>{e.detail}</p>
              <small>
                {e.actor}
                {e.draft_id && ` · Revision ID ${e.draft_id}`}
              </small>
              {e.from_status && (
                <div className="inline-meta">
                  <span>{e.from_status}</span>
                  <span>→</span>
                  <span>{e.to_status}</span>
                </div>
              )}
            </article>
          ))}
      </div>
    </section>
  );
}
