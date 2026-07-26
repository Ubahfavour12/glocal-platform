/**
 * Shared page header (Phase 3 polish). One consistent premium masthead across
 * the dashboard: mono datalabel, a title, an optional one-line subtitle, and an
 * optional right-aligned headline stat. Mirrors the pipeline page's header so
 * every surface reads as one designed product, not separate screens.
 */
export function PageHeader({
  label,
  title,
  subtitle,
  stat,
}: {
  label: string;
  title: string;
  subtitle?: string;
  stat?: { value: string; caption: string };
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="datalabel">{label}</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {stat && (
        <div className="shrink-0 text-right">
          <div className="font-mono text-2xl font-semibold text-ink">{stat.value}</div>
          <div className="datalabel">{stat.caption}</div>
        </div>
      )}
    </div>
  );
}
