"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadProductMedia, type MediaAsset } from "@/lib/media/storage";

/**
 * Product media library — UNLIKE onboarding's preview, these ARE stored (to
 * the product-media bucket), because the render lane needs the real image.
 * The most recent image becomes the source the agent turns into ad creatives.
 */
export function MediaUpload({
  businessId,
  existing,
}: {
  businessId: string;
  existing: { publicUrl: string; kind: string }[];
}) {
  const [items, setItems] = useState<{ publicUrl: string; kind: string }[]>(existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 5);
    if (files.length === 0) return;
    setBusy(true);
    setError("");
    const supabase = createClient();
    for (const f of files) {
      try {
        const a: MediaAsset = await uploadProductMedia(supabase, businessId, f);
        setItems((prev) => [{ publicUrl: a.publicUrl, kind: a.kind }, ...prev]);
      } catch (err) {
        setError((err as Error).message);
      }
    }
    setBusy(false);
  }

  return (
    <div className="rounded-card border border-line bg-surface-raised p-5">
      <div className="datalabel">product media</div>
      <p className="mt-2 text-sm text-ink-muted">
        Add product photos any time. The agent turns them into your ad creatives — more angles means
        more variety to test. Stored securely to your account.
      </p>

      <label className="mt-4 flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-ink-muted transition-colors hover:border-accent">
        {busy ? "Uploading…" : "Tap to add photos or videos"}
        <input type="file" accept="image/*,video/*" multiple className="hidden" disabled={busy} onChange={onChange} />
      </label>
      {error && <p className="mt-2 text-sm text-negative">{error}</p>}

      {items.length > 0 && (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {items.map((m, i) => (
            <div key={i} className="relative aspect-square overflow-hidden rounded-lg border border-line bg-surface-overlay">
              {m.kind === "video" ? (
                <video src={m.publicUrl} className="h-full w-full object-cover" muted playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.publicUrl} alt="" className="h-full w-full object-cover" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
