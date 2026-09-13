/**
 * Structured logging.
 *
 * The gap this closes: there was no logging. Not sparse logging — none. When a
 * customer says "it stopped working", there is currently nothing to search, no
 * request to follow, and no way to tell whether their nightly run even started.
 * During a 30-day dogfood with real money moving, that is the difference
 * between diagnosing a problem and guessing at one.
 *
 * Lines are JSON, one per event, because Vercel's log viewer and every log
 * service can filter structured fields but cannot usefully grep prose. A line
 * carries WHO (business), WHAT (event), and enough context to answer the next
 * question without a second deploy.
 *
 * REDACTION IS THE POINT, NOT A FEATURE. Logs get shipped to third parties,
 * pasted into chats, and read by whoever is on call. A secret that reaches a
 * log is a secret that has leaked, and the usual way that happens is somebody
 * logging a whole request object "just for now". Known-sensitive keys are
 * stripped here so that the careless version is still safe.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Keys whose values never belong in a log, whatever the caller intended. */
const SENSITIVE = [
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
  "key",
  "apikey",
  "signature",
  "email",
  "phone",
];

function isSensitive(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE.some((s) => k.includes(s));
}

/**
 * Strip sensitive values, recursively, with a depth cap.
 *
 * The cap matters: a caller passing a deeply nested or circular object should
 * produce a truncated log line, never a stack overflow inside the logger. A
 * logger that can crash the process it is reporting on is worse than no logger.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitive(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  return value;
}

export interface LogContext {
  /** Ties every line from one request together. */
  requestId?: string;
  businessId?: string;
  /** Anything else worth searching on later. */
  [key: string]: unknown;
}

function emit(level: LogLevel, event: string, ctx: LogContext = {}): void {
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...(redact(ctx) as Record<string, unknown>),
  });
  // console is the transport on Vercel: stdout is collected and searchable, and
  // an added log SDK would be another dependency and another key to hold.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, ctx?: LogContext) => emit("debug", event, ctx),
  info: (event: string, ctx?: LogContext) => emit("info", event, ctx),
  warn: (event: string, ctx?: LogContext) => emit("warn", event, ctx),
  error: (event: string, ctx?: LogContext) => emit("error", event, ctx),
};

/**
 * An id for one request, taken from the platform's own header when there is one
 * so our lines can be joined to Vercel's, and invented when there is not.
 */
export function requestId(headers: Headers): string {
  return (
    headers.get("x-vercel-id") ??
    headers.get("x-request-id") ??
    `req_${Math.random().toString(36).slice(2, 10)}`
  );
}
