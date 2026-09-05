"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STUDIO_QUESTIONS, type StudioAnswers } from "@/lib/studio/questions";

/**
 * The deep-brief form. Text, single-choice, and multi-choice questions; saves
 * to /api/studio, which appends each answer to that question's history and
 * weights the whole lot in the concept prompt.
 *
 * The fields start EMPTY and clear again after saving. This is deliberate: the
 * form is for what is true today, not for editing yesterday's wording. What the
 * agent already understands is shown above the form, read-only.
 */
export function StudioForm() {
  const router = useRouter();
  const [answers, setAnswers] = useState<StudioAnswers>({});
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState("");

  const filled = Object.values(answers).filter((v) =>
    Array.isArray(v) ? v.length > 0 : (v ?? "").trim().length > 0,
  ).length;

  function setText(id: string, value: string) {
    setAnswers((a) => ({ ...a, [id]: value }));
    setSavedCount(0);
  }
  function setSingle(id: string, value: string) {
    setAnswers((a) => ({ ...a, [id]: a[id] === value ? "" : value }));
    setSavedCount(0);
  }
  function toggleMulti(id: string, value: string, max: number) {
    setAnswers((a) => {
      const cur = Array.isArray(a[id]) ? (a[id] as string[]) : [];
      const next = cur.includes(value)
        ? cur.filter((v) => v !== value)
        : cur.length < max
          ? [...cur, value]
          : cur;
      return { ...a, [id]: next };
    });
    setSavedCount(0);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/studio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; saved?: number };
      if (!data.ok) throw new Error(data.error ?? "save failed");
      // Clear the form: these answers now live with the agent, and the next
      // visit is for adding what is true then.
      setAnswers({});
      setSavedCount(data.saved ?? 0);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      {STUDIO_QUESTIONS.map((q) => (
        <div
          key={q.id}
          className={`rounded-card border border-line bg-surface-raised p-5 ${
            q.type === "text" ? "lg:col-span-2" : ""
          }`}
        >
          <label className="text-sm font-medium text-ink">{q.label}</label>
          {q.hint && <p className="mt-1 text-xs text-ink-faint">{q.hint}</p>}

          {q.type === "text" && (
            <textarea
              value={(answers[q.id] as string) ?? ""}
              onChange={(e) => setText(q.id, e.target.value)}
              placeholder={q.placeholder}
              rows={2}
              className="mt-3 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          )}

          {q.type === "single" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {q.options?.map((o) => {
                const active = answers[q.id] === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setSingle(q.id, o.value)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? "border-accent bg-accent-soft text-accent-bright"
                        : "border-line text-ink-muted hover:text-ink"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}

          {q.type === "multi" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {q.options?.map((o) => {
                const cur = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
                const active = cur.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggleMulti(q.id, o.value, q.max ?? 3)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? "border-accent bg-accent-soft text-accent-bright"
                        : "border-line text-ink-muted hover:text-ink"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}

      <div className="sticky bottom-4 flex items-center justify-between rounded-card border border-line bg-surface-overlay/90 px-4 py-3 backdrop-blur lg:col-span-2">
        <span className="datalabel">
          {filled > 0 ? `${filled} to add` : "add what is true today"}
        </span>
        <div className="flex items-center gap-3">
          {error && <span className="text-sm text-negative">{error}</span>}
          {savedCount > 0 && !error && (
            <span className="text-sm text-positive">
              Saved {savedCount} to your agent ✓
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || filled === 0}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save to agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
