/**
 * The agent speaking in first person, plain language — UI Plan §1.
 * Amber accent is reserved for agent actions and highlights.
 */
export function AgentNote({ children, time }: { children: React.ReactNode; time?: string }) {
  return (
    <div className="rounded-card border-l-2 border-accent bg-accent-soft px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-bright" />
        <span className="datalabel text-accent-bright">agent</span>
        {time && <span className="datalabel">{time}</span>}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink">{children}</p>
    </div>
  );
}
