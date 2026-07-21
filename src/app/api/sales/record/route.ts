import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateOrder, type AttributedOrder, type CodeSource } from "@/lib/tracking/attribution";

/**
 * Mark-as-sold (UF-6 sales confirmation). The seller records one WHOLE order:
 * full total, optional quantity + items, and how it ties to an ad — the ref
 * code from the buyer's message, a seller-picked ad, or "none" (repeat
 * customer / direct buyer; valid and never forced onto an ad). Ownership and
 * code validity are enforced inside the record_sale database function.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "sign in first" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    business_id?: string;
    code?: string | null;
    code_source?: CodeSource;
    value_usd_minor?: number;
    quantity?: number;
    items?: { name: string; qty: number; unit_value_usd_minor?: number }[];
    order_ref?: string;
  } | null;

  if (!body?.business_id || !body.code_source || body.value_usd_minor === undefined) {
    return NextResponse.json(
      { error: "business_id, code_source and value_usd_minor required" },
      { status: 400 },
    );
  }

  const order: AttributedOrder = {
    code: body.code_source === "none" ? null : (body.code ?? null),
    codeSource: body.code_source,
    valueUsdMinor: body.value_usd_minor,
    quantity: body.quantity,
    items: body.items?.map((i) => ({
      name: i.name,
      qty: i.qty,
      unitValueUsdMinor: i.unit_value_usd_minor,
    })),
    source: "manual",
    at: new Date(),
  };
  const problems = validateOrder(order);
  if (problems.length > 0) {
    return NextResponse.json({ error: problems.join("; ") }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("record_sale", {
    p_business_id: body.business_id,
    p_code: order.code,
    p_code_source: order.codeSource,
    p_value_usd_minor: order.valueUsdMinor,
    p_quantity: order.quantity ?? null,
    p_items: order.items ?? null,
    p_order_ref: body.order_ref ?? null,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, conversion_id: data });
}
