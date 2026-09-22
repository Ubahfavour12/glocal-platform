import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { parseLeadBeacon } from "@/lib/tracking/pixel";
import { log } from "@/lib/log";

/**
 * Website enquiry beacon — an attributed lead with no human step.
 *
 * This is the automated answer for the website door, and it needs nothing from
 * Meta: the click id was stamped on the landing URL by our own redirect, the
 * pixel stored it on arrival, and the form sends it back. The visitor never
 * sees or types it, so unlike the WhatsApp prefill there is nothing sitting in
 * anyone's compose box to delete.
 *
 * PUBLIC BY NATURE. It runs in a stranger's browser, so there is no auth to
 * have. The defences are shape rather than identity:
 *
 *   - It only ever writes a lead to the business named in that site's own
 *     pixel code, so the worst an abuser achieves is noise in the data of the
 *     business whose pixel they copied.
 *   - An enquiry with no resolvable click is DROPPED, not recorded
 *     unattributed. An unattributed lead from an anonymous public endpoint is
 *     indistinguishable from a bot, and letting those in would poison
 *     cost-per-won — the exact number this whole feature exists to protect.
 *   - One lead per click, enforced by the unique index, so a form submitted
 *     twice or a page refreshed does not become two customers.
 */
export async function GET(req: NextRequest) {
  const parsed = parseLeadBeacon(req.nextUrl.searchParams);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  // No click, no lead. See above: this endpoint is anonymous.
  if (!parsed.cid) return NextResponse.json({ ok: true, recorded: false });

  try {
    const supabase = createServiceClient();
    const businessId = parsed.businessCode;

    const { data: click } = await supabase
      .from("click_events")
      .select("id, smart_link_id")
      .eq("app_cid", parsed.cid)
      .maybeSingle();
    if (!click?.smart_link_id) return NextResponse.json({ ok: true, recorded: false });

    const { data: link } = await supabase
      .from("smart_links")
      .select("id, business_id, ad_id, ads(creative_id)")
      .eq("id", click.smart_link_id)
      .maybeSingle();

    // The click must belong to the business whose pixel reported it. Without
    // this check a copied pixel could attach enquiries to somebody else's ads.
    if (!link || link.business_id !== businessId) {
      return NextResponse.json({ ok: true, recorded: false });
    }

    const { error } = await supabase.from("leads").upsert(
      {
        business_id: businessId,
        smart_link_id: link.id as string,
        ad_id: (link.ad_id as string | null) ?? null,
        creative_id:
          (link.ads as unknown as { creative_id: string | null } | null)?.creative_id ?? null,
        click_event_id: click.id as string,
        source: "smart_link",
        attribution: "pixel",
        label: parsed.label,
        // The click is the natural identity: one enquiry per visit, so a
        // double submit or a refresh cannot become two customers.
        external_ref: `pixel:${parsed.cid}`,
      },
      { onConflict: "business_id,external_ref", ignoreDuplicates: true },
    );
    if (error) throw error;

    return NextResponse.json({ ok: true, recorded: true });
  } catch (e) {
    log.error("lead.beacon_failed", { reason: e instanceof Error ? e.message : String(e) });
    // Always 200: this runs inside a customer's checkout or enquiry form, and
    // an error here must never surface as a broken page on their site.
    return NextResponse.json({ ok: true, recorded: false });
  }
}
