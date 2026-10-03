export default function Loading() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="eyebrow">BRAINOS / WORKSPACE</div>
      <h1>Opening your desk…</h1>
      <p>Loading the current evidence and saved revisions.</p>
      <div className="skeleton" aria-hidden="true" />
      <div className="loading-grid" aria-hidden="true">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    </div>
  );
}
