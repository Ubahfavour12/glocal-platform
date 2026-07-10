export default function DuelPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="datalabel">the duel</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Champion vs challengers</h1>
      <div className="mt-8 rounded-card border border-line bg-surface-raised p-8 text-center">
        <p className="text-sm text-ink-muted">
          No test running yet. The daily A/B duel appears here once your first
          campaign is live: threshold progress bars, the rolling 3-day chart,
          and the agent&apos;s verdict history.
        </p>
      </div>
    </div>
  );
}
