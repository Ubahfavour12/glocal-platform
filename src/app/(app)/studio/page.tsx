import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { StudioForm } from "@/components/studio/StudioForm";
import { MediaUpload } from "@/components/settings/MediaUpload";
import {
  answeredCount,
  latestAnswer,
  normaliseProfile,
  totalAnswersGiven,
} from "@/lib/studio/profile";
import { STUDIO_QUESTIONS } from "@/lib/studio/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Strategy Studio" };

export default async function StudioPage() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, strategy_profile")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!business) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader label="strategy studio" title="Tune your agent" />
        <p className="mt-6 text-sm text-ink-muted">Finish onboarding first, then tune your agent here.</p>
      </div>
    );
  }

  const profile = normaliseProfile(business.strategy_profile);
  const done = answeredCount(profile);
  const total = totalAnswersGiven(profile);

  const { count: mediaCount } = await supabase
    .from("media_assets")
    .select("id", { count: "exact", head: true })
    .eq("business_id", business.id);

  // What the agent currently understands: newest answer per question. This is
  // the read-only mirror of the brief, since the inputs clear after saving.
  const known = STUDIO_QUESTIONS.map((q) => ({
    id: q.id,
    label: q.label,
    value: latestAnswer(profile, q.id),
    depth: profile[q.id]?.length ?? 0,
  })).filter((k) => k.value);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        label="strategy studio"
        title="Tune your agent"
        subtitle="The deep brief. The more the agent knows about your business, the sharper and more specific its ad concepts get."
        stat={{ value: `${done}/${STUDIO_QUESTIONS.length}`, caption: "answered" }}
      />

      <div className="mt-6 rounded-card border border-line bg-surface-raised p-4 text-xs text-ink-muted">
        Everything here is optional, your quick-start answers already run the agent. Each answer you
        add is kept and stacked on top of the last one, so the agent keeps learning how you want to be
        seen rather than only remembering the most recent thing you typed. Come back any time and add
        what is true today.
      </div>

      {known.length > 0 && (
        <section className="mt-4 rounded-card border border-line bg-surface-raised p-5">
          <div className="flex items-center justify-between">
            <div className="datalabel">what your agent knows</div>
            <span className="datalabel">
              {total} answer{total === 1 ? "" : "s"} given
            </span>
          </div>
          <ul className="mt-3 flex flex-col gap-2.5">
            {known.map((k) => (
              <li key={k.id} className="border-b border-line-soft pb-2.5 last:border-0 last:pb-0">
                <div className="datalabel">{k.label}</div>
                <p className="mt-0.5 text-sm text-ink">{k.value}</p>
                {k.depth > 1 && (
                  <p className="mt-0.5 text-xs text-ink-faint">
                    Built from {k.depth} answers over time
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <StudioForm />

      <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
        <div className="datalabel">add photos &amp; video</div>
        <p className="mt-2 text-sm text-ink-muted">
          Anything that shows your product or your world. The agent uses these as raw material for
          your ads, and the more it has, the more it can vary what it makes.
        </p>
        <div className="mt-3">
          <MediaUpload businessId={business.id as string} existingCount={mediaCount ?? 0} />
        </div>
      </section>
    </div>
  );
}
