"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STUDIO_QUESTIONS, type StudioAnswers } from "@/lib/studio/questions";
import { answeredCount } from "@/lib/studio/profile";

/**
 * The deep-brief form. Text, single-choice, and multi-choice questions; saves
 * the whole set to /api/studio, which the concept engine then weights heavily.
 */
export function StudioForm({ initial }: { initial: StudioAnswers }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<StudioAnswers>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const done = answeredCount(answers);

  function setText(id: string, value: string) {
    setAnswers((a) => ({ ...a, [id]: value }));
    setSaved(false);
  }
  function setSingle(id: string, value: string) {
    setAnswers((a) => ({ ...a, [id]: a[id] === value ? "" : value }));
    setSaved(false);
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
    setSaved(false);
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
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "save failed");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      {STUDIO_QUESTIONS.map((q) => (
        <div key={q.id} className="rounded-card border border-line bg-surface-raised p-5">
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

      <div className="sticky bottom-4 flex items-center justify-between rounded-card border border-line bg-surface-overlay/90 px-4 py-3 backdrop-blur">
        <span className="datalabel">{done} / {STUDIO_QUESTIONS.length} answered</span>
        <div className="flex items-center gap-3">
          {error && <span className="text-sm text-negative">{error}</span>}
          {saved && !error && <span className="text-sm text-positive">Saved ✓</span>}
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save brief"}
          </button>
        </div>
      </div>
    </div>
  );
}
