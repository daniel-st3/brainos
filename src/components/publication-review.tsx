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
  cloud: boolean;
  outbox_id: string | null;
  expires_at: string;
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
            : "Publish after your approval"}
        </p>
      </header>
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
      {!view.cloud && (
        <p role="status">
          Cloud task connection pending.{" "}
          {view.demo
            ? "This review tests the simulator only."
            : "Approval to publish is disabled until Trigger.dev is connected."}
        </p>
      )}
      <section aria-label="Final media" className="publication-media">
        {frozen.media.map((m, i) => (
          <figure key={`${m.sha256}:${i}`}>
            {m.mime.startsWith("video/") ? (
              <video
                controls
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
          Rights and current evidence are required before this candidate is
          created and checked again before sending.
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
          {frozen.package_version} · Draft revision {frozen.draft_revision}
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
              ? "Only your approval allows this exact package to be sent."
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
                  loadedMedia.length < frozen.media.length ||
                  (!view.demo && !view.cloud)
                }
                onClick={() => decide("approve")}
              >
                {frozen.due_at ? "APPROVE & SCHEDULE" : "APPROVE & PUBLISH"}
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
