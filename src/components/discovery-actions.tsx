"use client";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
export function DiscoveryForm({
  endpoint,
  values,
  label,
  children,
}: {
  endpoint: string;
  values?: Record<string, unknown>;
  label: string;
  children?: ReactNode;
}) {
  const router = useRouter(),
    [pending, setPending] = useState(false),
    [refreshing, startRefresh] = useTransition(),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  return (
    <form
      className="command-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError("");
        setMessage("");
        const fields = Object.fromEntries(new FormData(e.currentTarget));
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...values, ...fields }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          setMessage(data.message);
          startRefresh(() => {
            if (data.href) router.push(data.href);
            else router.refresh();
          });
        } catch (error) {
          setError(error instanceof Error ? error.message : "Request failed.");
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
      <button className="button secondary" disabled={pending || refreshing}>
        {pending || refreshing ? "Working…" : label}
      </button>
      {message && (
        <p role="status" className="form-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}
export function MissedStoryForm() {
  return (
    <details className="panel">
      <summary>The system missed a story</summary>
      <p className="subtle">
        Save the original URL and why it matters. This records a manual-only
        discovery, not verified evidence.
      </p>
      <DiscoveryForm endpoint="/api/discovery" label="Save missed story">
        <label>
          Story headline
          <input name="title" required minLength={5} />
        </label>
        <label>
          Original story URL
          <input name="url" type="url" required />
        </label>
        <label>
          Why did this deserve discovery?
          <textarea name="notes" />
        </label>
      </DiscoveryForm>
    </details>
  );
}
export function Observation({
  storyId,
  kind,
  briefId = null,
  rank = null,
}: {
  storyId: string;
  kind: "surfaced" | "opened";
  briefId?: string | null;
  rank?: number | null;
}) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let recorded = false;
    const observe = () => {
      if (recorded) return;
      recorded = true;
      void fetch("/api/pilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId, kind, briefId, rank }),
        keepalive: true,
      }).catch(() => {
        /* Pilot observations must not block reading. */
      });
    };
    if (kind === "opened") {
      observe();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observe();
        observer.disconnect();
      }
    });
    if (marker.current) observer.observe(marker.current);
    return () => observer.disconnect();
  }, [storyId, kind, briefId, rank]);
  return (
    <span
      ref={marker}
      aria-hidden="true"
      style={{ display: "block", height: 1 }}
    />
  );
}
