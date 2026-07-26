"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadProductMedia } from "@/lib/media/storage";

/**
 * Product media, fire-and-forget. The customer adds photos and they're sent
 * straight to the agent (stored in the product-media bucket for the render
 * lane); we do NOT keep a thumbnail gallery hanging around. On success we just
 * confirm it landed and show a running count of the library, nothing else.
 */
export function MediaUpload({
  businessId,
  existingCount,
}: {
  businessId: string;
  existingCount: number;
}) {
  const [count, setCount] = useState(existingCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justSaved, setJustSaved] = useState(0);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 5);
    e.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    setError("");
    const supabase = createClient();
    let added = 0;
    for (const f of files) {
      try {
        await uploadProductMedia(supabase, businessId, f); // stored + indexed; nothing to display
        added += 1;
      } catch (err) {
        setError((err as Error).message);
      }
    }
    setBusy(false);
    if (added > 0) {
      setCount((c) => c + added);
      setJustSaved(added);
      setTimeout(() => setJustSaved(0), 5000);
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface-raised p-5">
      <div className="datalabel">product media</div>
      <p className="mt-2 text-sm text-ink-muted">
        Add product photos any time. They go straight to your agent, which turns them into ad
        creatives, more angles means more variety to test. Nothing to manage here afterwards.
      </p>

      <label className="mt-4 flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-ink-muted transition-colors hover:border-accent">
        {busy ? "Sending to your agent…" : "Tap to add photos or videos"}
        <input type="file" accept="image/*,video/*" multiple className="hidden" disabled={busy} onChange={onChange} />
      </label>

      {error && <p className="mt-2 text-sm text-negative">{error}</p>}

      {justSaved > 0 && !busy && (
        <p className="mt-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm">
          <span className="text-positive">✓ Sent.</span>{" "}
          <span className="text-ink-muted">
            {justSaved} {justSaved === 1 ? "photo is" : "photos are"} with your agent for your next ad
            creatives. Nothing else to do.
          </span>
        </p>
      )}

      {count > 0 && (
        <p className="mt-2 text-xs text-ink-faint">
          {count} {count === 1 ? "photo" : "photos"} in your library. The agent always uses your newest
          ones as the source.
        </p>
      )}
    </div>
  );
}
