"use client";
/* Private, exact media must bypass Next image optimization and public caches. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Candidate } from "@/approval/model";
type View = {
  id: string;
  version: number;
  demo: boolean;
  checksum: string;
  frozen: Candidate["frozen"];
  state: string;
  decision: Candidate["decision"];
  current: boolean;
  blockers?: string[];
  cloud: boolean;
  outbox_id: string | null;
  expires_at: string | null;
  expired: boolean;
};
export function PublicationReview({ id }: { id: string }) {
  const [loadedMedia, setLoadedMedia] = useState<number[]>([]);
  const [mediaError, setMediaError] = useState(false);
  const [view, setView] = useState<View | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState("");
  async function load() {
    const r = await fetch(`/api/approvals/${id}`, { cache: "no-store" });
    if (!r.ok)
      throw Error("This review is unavailable. Sign in and try again.");
    setView(await r.json());
  }
  useEffect(() => {
    let active = true;
    fetch(`/api/approvals/${id}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok)
          throw Error("This review is unavailable. Sign in and try again.");
        const data = await r.json();
        if (active) setView(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function decide(decision: "approve" | "request_changes" | "reject") {
    if (!view) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checksum: view.checksum, decision, feedback }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      await load();
      if (result.wake?.pending)
        setError(
          "Decision saved. Cloud resume is pending; it is safe to close this page.",
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save decision");
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  if (!view)
    return (
      <section aria-busy={!error}>
        <p role="status">
          {error || "Loading the exact publication candidate…"}
        </p>
        <button onClick={() => load().catch((e) => setError(e.message))}>
          Retry
        </button>
      </section>
    );
  const frozen = view.frozen;
  const reviewOnly = !!frozen.imported && !frozen.imported.publication;
  const documentedReel =
    frozen.imported?.publication?.kind === "documented-instagram-reel/v1";
  const conditions = frozen.imported?.manifests.rights.conditions;
  const open = view.state === "AWAITING_DANIEL" && !view.expired;
  return (
    <article className="publication-review">
      <header>
        <p className="eyebrow">
          {view.demo
            ? "SIMULATION · NO SOCIAL POST"
            : "FINAL PUBLICATION REVIEW"}
        </p>
        <h1>{frozen.title}</h1>
        <p>
          {frozen.platform} · @{frozen.handle}
        </p>
        <p>
          {frozen.due_at
            ? `Scheduled: ${new Date(frozen.due_at).toLocaleString()}`
            : reviewOnly
              ? "Private review · publication blocked"
              : "Publish after your approval"}
        </p>
      </header>
      {frozen.imported && (
        <section role="alert" aria-label="Rights and publication blockers">
          <h2>
            {reviewOnly
              ? `Rights risk: ${frozen.imported.manifests.rights.overall_risk} · UNCLEAR`
              : documentedReel
                ? `Rights basis documented · residual risk: ${frozen.imported?.manifests.rights.overall_risk}. No permission or legal clearance implied.`
                : "Rights: CLEARED for the proposed use"}
          </h2>
          <p>
            Creative revision: {frozen.imported.revision}. These original files
            have not been altered.
          </p>
          <ul>
            {(view.blockers ?? []).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          {Array.isArray(conditions) && (
            <ul aria-label="Attribution and share-alike obligations">
              {conditions.map((condition, i) => (
                <li key={i}>{String(condition)}</li>
              ))}
            </ul>
          )}
          <p>
            {reviewOnly ? (
              <>
                Approval records your review only. It will not enqueue or
                publish this package.
              </>
            ) : documentedReel ? (
              "Approval authorizes this exact Reel, selected video-frame cover and caption on the documented publication basis, including the disclosed residual risks."
            ) : (
              "Approval authorizes this exact carousel and its complete attribution caption for the guarded publication outbox."
            )}
          </p>
        </section>
      )}
      {open && (
        <p>
          <a className="button secondary" href="#publication-decision">
            Review decision
          </a>
        </p>
      )}
      {!view.current && (
        <p role="alert">
          This candidate is stale. Prepare a new revision before approving.
        </p>
      )}
      <section aria-label="Final media" className="publication-media">
        {frozen.media.map((m, i) => (
          <figure key={`${m.sha256}:${i}`}>
            {m.mime.startsWith("video/") ? (
              <video
                controls
                poster={
                  frozen.imported?.poster && i === 0
                    ? `/api/approvals/${id}/media?index=0&poster=true`
                    : undefined
                }
                onLoadedMetadata={() =>
                  setLoadedMedia((current) => [...new Set([...current, i])])
                }
                onError={() => setMediaError(true)}
                playsInline
                preload="metadata"
                src={`/api/approvals/${id}/media?index=${i}`}
                aria-label={`Final video ${i + 1}`}
              />
            ) : (
              <img
                src={`/api/approvals/${id}/media?index=${i}`}
                onLoad={() =>
                  setLoadedMedia((current) => [...new Set([...current, i])])
                }
                onError={() => setMediaError(true)}
                alt={`Final approved media, item ${i + 1} of ${frozen.media.length}`}
              />
            )}
            <figcaption>
              {i + 1} / {frozen.media.length} · {m.mime}
            </figcaption>
          </figure>
        ))}
        {!frozen.media.length && <p>Text-only publication.</p>}
      </section>
      <section aria-label="Exact caption">
        <h2>Final caption</h2>
        <p className="exact-caption">{frozen.caption}</p>
        {frozen.thread.map((text, i) => (
          <p className="exact-caption" key={i}>
            {i + 1}. {text}
          </p>
        ))}
      </section>
      <details>
        <summary>Sources, rights and exact version</summary>
        <p>
          {reviewOnly
            ? "Original source/rights manifests are bound to this candidate. Rights remain unresolved; no publication authority has been granted."
            : "Rights and current evidence are required before this candidate is created and checked again before sending."}
        </p>
        {frozen.sources.map((url) => (
          <p key={url}>
            <a href={url} target="_blank" rel="noreferrer">
              {url}
            </a>
          </p>
        ))}
        <p>
          Content revision {frozen.content_version} · Package revision{" "}
          {frozen.package_version} ·{" "}
          {frozen.imported
            ? frozen.imported.revision
            : `Draft revision ${frozen.draft_revision}`}
        </p>
        <code>{view.checksum}</code>
        <p>Candidate: {id}</p>
        {frozen.media.map((m, i) => (
          <p key={i}>
            <code>{m.sha256}</code>
          </p>
        ))}
      </details>
      {mediaError && (
        <p role="alert">Final media could not load. Reload before approving.</p>
      )}
      <section
        id="publication-decision"
        className="publication-decision"
        aria-label="Your decision"
      >
        <p role="status">
          {view.decision
            ? `Decision saved: ${view.decision.decision.replaceAll("_", " ")}. ${view.outbox_id ? "Handed to the guarded outbox; receipt appears after dispatch." : ""}`
            : open
              ? reviewOnly
                ? "Your decision applies to this exact creative. Publication remains blocked."
                : "Only your approval allows this exact package to be sent."
              : "This review is closed."}
        </p>
        {open && (
          <>
            <label htmlFor="review-feedback">Notes / requested changes</label>
            <textarea
              id="review-feedback"
              value={feedback}
              maxLength={4000}
              onChange={(e) => setFeedback(e.target.value)}
            />
            <div className="review-decision-buttons">
              <button
                className="button"
                disabled={
                  busy ||
                  !view.current ||
                  mediaError ||
                  loadedMedia.length < frozen.media.length
                }
                onClick={() => decide("approve")}
              >
                {reviewOnly
                  ? "APPROVE"
                  : frozen.due_at
                    ? "APPROVE & SCHEDULE"
                    : "APPROVE & PUBLISH"}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => decide("request_changes")}
              >
                REQUEST CHANGES
              </button>
              <button
                className="button quiet"
                disabled={busy}
                onClick={() => decide("reject")}
              >
                REJECT
              </button>
            </div>
          </>
        )}
        {view.decision?.decision === "request_changes" && (
          <Link href={`/stories/${frozen.story_id}?tab=drafts`}>
            Open the revision workspace
          </Link>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </article>
  );
}
