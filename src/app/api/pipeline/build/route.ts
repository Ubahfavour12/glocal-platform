import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { buildPipelineBatch } from "@/lib/research/pipeline";
import { livePipelineDeps } from "@/lib/research/pipeline-live";

export const maxDuration = 60;

/**
 * Phase 2.1 — the agent comes alive after signup. Fired (fire-and-forget) by
 * onboarding: researches the niche and writes the first concept batch for the
 * signed-in user's business. The nightly cron tops the pool up to the target.
 * Idempotent: a full pipeline short-circuits, so repeat calls are harmless.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "sign in first" }, { status: 401 });
  }

  // Ownership via the user-scoped client (RLS), work via the service client.
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) {
    return NextResponse.json({ error: "finish onboarding first" }, { status: 404 });
  }

  const result = await buildPipelineBatch(livePipelineDeps(createServiceClient()), business.id);
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
}
