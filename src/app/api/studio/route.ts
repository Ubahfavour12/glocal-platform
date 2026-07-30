import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { STUDIO_QUESTIONS, type StudioAnswers } from "@/lib/studio/questions";

/**
 * Save the Strategy Studio deep brief. RLS-scoped to the owner's business.
 * Whitelists to known question ids and clamps sizes so the stored JSON stays
 * tidy and the concept prompt can trust it.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { answers?: StudioAnswers };
  try {
    body = (await req.json()) as { answers?: StudioAnswers };
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const ids = new Set(STUDIO_QUESTIONS.map((q) => q.id));
  const clean: StudioAnswers = {};
  for (const [k, v] of Object.entries(body.answers ?? {})) {
    if (!ids.has(k)) continue;
    if (Array.isArray(v)) {
      clean[k] = v.filter((x): x is string => typeof x === "string").slice(0, 5);
    } else if (typeof v === "string") {
      clean[k] = v.slice(0, 2000);
    }
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) return NextResponse.json({ ok: false, error: "no business" }, { status: 404 });

  const { error } = await supabase
    .from("businesses")
    .update({ strategy_profile: clean })
    .eq("id", business.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
