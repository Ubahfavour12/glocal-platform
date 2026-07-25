/**
 * Turn a raw journal/audit entry into a plain-language line for the Activity
 * feed and the notification bell (Phase 3). The agent's actions are stored as
 * { action, detail }; this maps them to what a person actually reads.
 */

export interface RawEntry {
  entry_type?: string;
  content?: { action?: string; detail?: unknown; message?: string } & Record<string, unknown>;
  created_at?: string;
}

const LABELS: Record<string, string> = {
  pipeline_batch: "Added fresh concepts to your pipeline",
  verdict: "Judged yesterday's duel",
  fatigue: "Refreshed the champion's creative style",
  gateway_scan: "Compliance-checked a concept",
  plan_created: "Prepared tomorrow's plan for your approval",
  plan_launched: "Launched your ads on Meta (paused until you're funded)",
  organic_post: "Scheduled an organic post",
  organic_scheduled: "Scheduled organic content",
  rejection: "Handled an ad rejection to protect your account",
  render_batch: "Rendered new creatives",
  launch_skipped: "Waiting to provision your ad account",
};

function prettify(action: string): string {
  return action.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Pure: a human line for one entry. Prefers an explicit customer message. */
export function describeActivity(entry: RawEntry): string {
  const c = entry.content ?? {};
  if (typeof c.message === "string" && c.message) return c.message;
  const action = typeof c.action === "string" ? c.action : "";
  if (action && LABELS[action]) return LABELS[action];
  if (action) return prettify(action);
  return "Agent activity";
}

/** Pure: compact relative time, e.g. "3m", "2h", "4d". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
