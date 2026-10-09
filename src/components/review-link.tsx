"use client";
import { useEffect, useState } from "react";
import { PublicationReview } from "./publication-review";
export function EmailReview({ id }: { id: string }) {
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const token = window.location.hash.slice(1);
    // The secret never reaches server URL logs, source links, analytics or Referer.
    window.history.replaceState(null, "", window.location.pathname);
    let active = true;
    const start = token
      ? fetch(`/api/approvals/${id}/access`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        })
      : fetch(`/api/approvals/${id}`, { cache: "no-store" });
    start
      .then((r) => {
        if (!r.ok)
          throw Error(
            "This review link is invalid or expired. Open the latest review email.",
          );
        if (active) setReady(true);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  return ready ? (
    <PublicationReview id={id} />
  ) : (
    <p role="status">{error || "Opening your private review…"}</p>
  );
}
