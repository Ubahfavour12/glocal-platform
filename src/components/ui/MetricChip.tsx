export function MetricChip({
  label,
  value,
  hint,
  trend,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: "up" | "down" | "flat";
}) {
  const trendGlyph = trend === "up" ? "▲" : trend === "down" ? "▼" : trend === "flat" ? "—" : null;
  const trendColor =
    trend === "up" ? "text-positive" : trend === "down" ? "text-negative" : "text-ink-faint";
  return (
    <div className="rounded-card border border-line bg-surface-raised px-4 py-3">
      <div className="datalabel">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-xl font-semibold text-ink">{value}</span>
        {trendGlyph && <span className={`text-xs ${trendColor}`}>{trendGlyph}</span>}
      </div>
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}
