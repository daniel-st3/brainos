"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty" role="alert">
      <div className="eyebrow">WORKSPACE / LOAD INTERRUPTED</div>
      <h1>The newsroom could not load.</h1>
      <p>
        Your saved revisions are preserved. Check the server configuration or
        try again.
      </p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
