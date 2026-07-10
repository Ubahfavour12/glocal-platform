export default function ActivityPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="datalabel">activity</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Everything the agent did</h1>
      <div className="mt-8 rounded-card border border-line bg-surface-raised p-8 text-center">
        <p className="text-sm text-ink-muted">
          The full audit trail: every launch, pause, budget move, compliance
          scan, and verdict — in plain language, within a minute of it
          happening.
        </p>
      </div>
    </div>
  );
}
