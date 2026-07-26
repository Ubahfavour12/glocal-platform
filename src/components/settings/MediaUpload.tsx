"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadProductMedia, deleteProductMedia, type MediaAsset } from "@/lib/media/storage";

type Item = { id: string; publicUrl: string; kind: string; storagePath: string };

/**
 * Product media library, UNLIKE onboarding's preview, these ARE stored (to
 * the product-media bucket), because the render lane needs the real image.
 * The most recent image becomes the source the agent turns into ad creatives.
 * Every file can be removed; each upload confirms it's saved to the account.
 */
export function MediaUpload({
  businessId,
  existing,
}: {
  businessId: string;
  existing: Item[];
}) {
  const [items, setItems] = useState<Item[]>(existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justSaved, setJustSaved] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);

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
        const a: MediaAsset = await uploadProductMedia(supabase, businessId, f);
        setItems((prev) => [
          { id: a.id, publicUrl: a.publicUrl, kind: a.kind, storagePath: a.storagePath },
          ...prev,
        ]);
        added += 1;
      } catch (err) {
        setError((err as Error).message);
      }
    }
    setBusy(false);
    if (added > 0) {
      setJustSaved(added);
      setTimeout(() => setJustSaved(0), 4000);
    }
  }

  async function remove(item: Item) {
    setRemoving(item.id);
    setError("");
    try {
      const supabase = createClient();
      await deleteProductMedia(supabase, item.id, item.storagePath);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface-raised p-5">
      <div className="datalabel">product media</div>
      <p className="mt-2 text-sm text-ink-muted">
        Add product photos any time. The agent turns them into your ad creatives, more angles means
        more variety to test. Saved securely to your account the moment you add them.
      </p>

      <label className="mt-4 flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-ink-muted transition-colors hover:border-accent">
        {busy ? "Saving…" : "Tap to add photos or videos"}
        <input type="file" accept="image/*,video/*" multiple className="hidden" disabled={busy} onChange={onChange} />
      </label>

      {error && <p className="mt-2 text-sm text-negative">{error}</p>}
      {justSaved > 0 && !busy && (
        <p className="mt-2 text-sm text-positive">
          ✓ {justSaved} {justSaved === 1 ? "file" : "files"} saved to your account.
        </p>
      )}

      {items.length > 0 && (
        <>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {items.map((m) => (
              <div key={m.id} className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-surface-overlay">
                {m.kind === "video" ? (
                  <video src={m.publicUrl} className="h-full w-full object-cover" muted playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.publicUrl} alt="" className="h-full w-full object-cover" />
                )}
                <button
                  type="button"
                  onClick={() => remove(m)}
                  disabled={removing === m.id}
                  aria-label="Remove"
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white opacity-0 transition-opacity hover:bg-black/80 focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                >
                  {removing === m.id ? "…" : "✕"}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-xs text-ink-muted">
            <span className="text-positive">✓ Saved.</span> Nothing else to click, the agent uses your
            newest photo as the source for the two creatives it renders for your next daily test. Hover
            any photo to remove it.
          </div>
        </>
      )}
    </div>
  );
}
