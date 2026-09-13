import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { StudioForm } from "@/components/studio/StudioForm";
import { MediaUpload } from "@/components/settings/MediaUpload";
import { ContextFeed } from "@/components/studio/ContextFeed";
import {
  answeredCount,
  contextNotes,
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
    .select("id, strategy_profile, plan")
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

  // Strategy Studio is a Growth+ feature (see lib/billing/tiers.ts). Starter and
  // free accounts can look, so they understand what they would get, but the
  // brief they save would not be used, so saving is disabled rather than
  // silently ignored.
  const tier = (business.plan as string) ?? "free";
  const unlocked = tier === "growth" || tier === "scale";

  const profile = normaliseProfile(business.strategy_profile);
  const done = answeredCount(profile);
  const total = totalAnswersGiven(profile);

  const notes = contextNotes(business.strategy_profile);

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
    <div className="mx-auto max-w-3xl lg:max-w-5xl">
      <PageHeader
        label="strategy studio"
        title="Tune your agent"
        subtitle="The deep brief. The more the agent knows about your business, the sharper and more specific its ad concepts get."
        stat={{ value: `${done}/${STUDIO_QUESTIONS.length}`, caption: "answered" }}
      />

      {unlocked ? (
        <div className="mt-6 rounded-card border border-line bg-surface-raised p-4 text-xs text-ink-muted">
          Everything here is optional, your quick-start answers already run the agent. Each answer you
          add is kept and stacked on top of the last one, so the agent keeps learning how you want to
          be seen rather than only remembering the most recent thing you typed. Come back any time and
          add what is true today.
        </div>
      ) : (
        <div className="mt-6 rounded-card border border-accent/40 bg-accent-soft p-5">
          <div className="datalabel text-accent-bright">growth &amp; scale</div>
          <p className="mt-2 text-sm text-ink">
            The Strategy Studio is part of the Growth and Scale plans. Have a look around, this is the
            deep brief that makes the agent write about your business specifically instead of your
            category generally.
          </p>
          <a
            href="/upgrade"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
          >
            See the plans
          </a>
        </div>
      )}

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

      {unlocked && <StudioForm />}

      <section className="mt-6 rounded-card border border-line bg-surface-raised p-5">
        <div className="datalabel">add photos &amp; video</div>
        <p className="mt-2 text-sm text-ink-muted">
          Anything that shows your product or your world. The agent uses these as raw material for
          your ads, and the more it has, the more it can vary what it makes.
        </p>
        <div className="mt-3">
          <div className="rounded-card border border-line bg-surface-raised p-5">
            <div className="datalabel">add more context</div>
            <p className="mt-2 text-sm text-ink-muted">
              The ten questions above are the shape of your business. This is for
              what changed this week.
            </p>
            <ContextFeed disabled={!unlocked} />

            {notes.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <div className="datalabel">what your agent has absorbed</div>
                <ul className="mt-3 flex flex-col gap-2.5">
                  {notes.map((n, i) => (
                    <li key={i} className="text-sm leading-relaxed text-ink-muted">
                      <span className="text-ink">{n.text}</span>
                      {n.at && (
                        <span className="ml-2 text-xs text-ink-faint">
                          {new Date(n.at).toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-ink-faint">
                  The newest is treated as current truth; the rest stay as
                  background.
                </p>
              </div>
            )}
          </div>

          <MediaUpload businessId={business.id as string} existingCount={mediaCount ?? 0} />
        </div>
      </section>
    </div>
  );
}
