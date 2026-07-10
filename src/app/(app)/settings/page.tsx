export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="datalabel">settings</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Connections &amp; plan</h1>
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-line bg-surface-raised p-5">
          <div className="datalabel">store connection</div>
          <p className="mt-2 text-sm text-ink-muted">
            Connect Shopify to unlock true ROAS tracking — one click, zero code.
          </p>
        </div>
        <div className="rounded-card border border-line bg-surface-raised p-5">
          <div className="datalabel">full-auto mode</div>
          <p className="mt-2 text-sm text-ink-muted">
            Off. The agent asks for your approval every evening. Full autonomy
            unlocks after your first 30 days.
          </p>
        </div>
      </div>
    </div>
  );
}
