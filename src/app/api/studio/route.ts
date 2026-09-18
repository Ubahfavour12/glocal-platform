import { checkRateLimit, retryAfterSeconds } from "@/lib/net/rate-limit";
import { log } from "@/lib/log";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { STUDIO_QUESTIONS, type StudioAnswers } from "@/lib/studio/questions";
import { FREEFORM_KEY, appendAnswer, normaliseProfile } from "@/lib/studio/profile";
import { currentBusiness } from "@/lib/business/current";

/**
 * Save Strategy Studio answers. RLS-scoped to the owner's business.
 *
 * Answers are APPENDED to each question's history, never overwritten: the
 * owner's view of their own business develops over time and every answer they
 * have given is signal the agent can use. The form clears after saving, so the
 * next visit is about adding what is true now rather than editing old text.
 *
 * Whitelists to known question ids and clamps sizes so the stored JSON stays
 * tidy and the concept prompt can trust it.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });


  // Rate limited because this route spends OUR money on every call. Scoped to
  // the signed-in user so one person's loop cannot lock anyone else out.
  const limit = await checkRateLimit("studioSave", user.id);
  if (!limit.allowed) {
    log.warn("ratelimit.blocked", { route: "studioSave", userId: user.id, count: limit.count });
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds("studioSave")) } },
    );
  }
  let body: { answers?: StudioAnswers };
  try {
    body = (await req.json()) as { answers?: StudioAnswers };
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  // The ten questions, plus the reserved free-form key. Everything else is
  // dropped rather than stored, so a crafted request cannot bloat the row.
  const ids = new Set<string>([...STUDIO_QUESTIONS.map((q) => q.id), FREEFORM_KEY]);
  const incoming: StudioAnswers = {};
  for (const [k, v] of Object.entries(body.answers ?? {})) {
    if (!ids.has(k)) continue;
    if (Array.isArray(v)) {
      const arr = v.filter((x): x is string => typeof x === "string").slice(0, 5);
      if (arr.length) incoming[k] = arr;
    } else if (typeof v === "string" && v.trim()) {
      incoming[k] = v.trim().slice(0, 2000);
    }
  }

  const business = await currentBusiness<{ id: string } & Record<string, unknown>>(
    supabase,
    "id, strategy_profile",
  );
  if (!business) return NextResponse.json({ ok: false, error: "no business" }, { status: 404 });

  const savedCount = Object.keys(incoming).length;
  if (savedCount === 0) return NextResponse.json({ ok: true, saved: 0 });

  const at = new Date().toISOString();
  let profile = normaliseProfile(business.strategy_profile);
  for (const [k, v] of Object.entries(incoming)) {
    profile = appendAnswer(profile, k, v as string | string[], at);
  }

  const { error } = await supabase
    .from("businesses")
    .update({ strategy_profile: profile })
    .eq("id", business.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, saved: savedCount });
}
