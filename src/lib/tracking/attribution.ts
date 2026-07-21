/**
 * Sale attribution & preference learning — Slice C (locked 2026-07-21).
 *
 * Chain: every ad gets a smart link with a unique CODE. For WhatsApp ads the
 * buyer's first message carries that code ("ref GL-7K4"), so the seller always
 * knows which ad brought which buyer. A sale is recorded as one whole ORDER
 * (total value + quantity + items), whether it comes from mark-as-sold, the
 * website pixel, or a connected store. Multi-product and multi-quantity
 * orders are first-class: we attribute the FULL order value to the ad, and
 * we learn product preference from what buyers actually bought.
 *
 * Verdicts still use the hierarchy (revenue > intent > engagement) — signals
 * are never blended into one score, because 1,000 cheap clicks must not
 * outvote 3 real sales. Preference learning uses everything.
 */

// ---------- per-ad reference codes ----------

/** Prefill for a WhatsApp ad's first message; the buyer sends it as-is. */
export function buildWhatsappPrefill(code: string, productHint?: string): string {
  const about = productHint ? ` about ${productHint}` : "";
  return `Hi! I saw your ad${about} and I'm interested. (ref ${code})`;
}

const REF_PATTERN = /\(ref\s+([A-Za-z0-9_-]{3,24})\)/;

/** Pull the ad reference code out of a buyer's message, if present. */
export function extractRefCode(messageText: string): string | null {
  const m = REF_PATTERN.exec(messageText ?? "");
  return m ? m[1] : null;
}

// ---------- orders (one conversion = one whole order) ----------

export interface OrderItem {
  name: string;
  qty: number;
  /** unit price when known; manual sellers may skip it */
  unitValueUsdMinor?: number;
}

export interface AttributedOrder {
  /** smart-link code of the ad that brought this buyer */
  code: string;
  /** FULL order total in USD minor units — every unit, every product */
  valueUsdMinor: number;
  quantity?: number;
  items?: OrderItem[];
  source: "manual" | "pixel" | "store" | "platform";
  at: Date;
}

/**
 * Validate a mark-as-sold entry. The seller types the order total (and
 * optionally what was bought); we refuse silently-wrong data instead of
 * polluting the verdict engine.
 */
export function validateOrder(order: AttributedOrder): string[] {
  const problems: string[] = [];
  if (!order.code || order.code.length < 3) problems.push("missing ad reference code");
  if (!Number.isInteger(order.valueUsdMinor) || order.valueUsdMinor <= 0)
    problems.push("order value must be a positive integer in minor units");
  if (order.quantity !== undefined && (!Number.isInteger(order.quantity) || order.quantity <= 0))
    problems.push("quantity must be a positive integer");
  if (order.items) {
    for (const it of order.items) {
      if (!it.name?.trim()) problems.push("every item needs a name");
      if (!Number.isInteger(it.qty) || it.qty <= 0) problems.push(`invalid qty for ${it.name}`);
    }
    if (order.quantity !== undefined) {
      const itemUnits = order.items.reduce((s, it) => s + it.qty, 0);
      if (itemUnits !== order.quantity)
        problems.push(`quantity (${order.quantity}) does not match item units (${itemUnits})`);
    }
  }
  return problems;
}

/** Revenue per ad code — feeds the verdict engine's revenueUsdMinor. */
export function revenueByCode(orders: readonly AttributedOrder[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of orders) {
    out.set(o.code, (out.get(o.code) ?? 0) + o.valueUsdMinor);
  }
  return out;
}

// ---------- preference learning ----------

export interface ProductPreference {
  name: string;
  units: number;
  revenueUsdMinor: number;
  /** share of known-item revenue, 0..1 */
  revenueShare: number;
  orders: number;
}

/**
 * What do this business's buyers actually prefer? Aggregated from order
 * items across all sources. Items are matched case-insensitively so
 * "Gold Bracelet" and "gold bracelet" are one product.
 */
export function productPreferences(orders: readonly AttributedOrder[]): ProductPreference[] {
  const byProduct = new Map<
    string,
    { name: string; units: number; revenueUsdMinor: number; orders: number }
  >();
  let knownRevenue = 0;

  for (const o of orders) {
    if (!o.items?.length) continue;
    // apportion order value across items by units when unit prices are absent
    const totalUnits = o.items.reduce((s, it) => s + it.qty, 0);
    for (const it of o.items) {
      const key = it.name.trim().toLowerCase();
      const rec = byProduct.get(key) ?? {
        name: it.name.trim(),
        units: 0,
        revenueUsdMinor: 0,
        orders: 0,
      };
      const itemRevenue =
        it.unitValueUsdMinor !== undefined
          ? it.unitValueUsdMinor * it.qty
          : Math.round((o.valueUsdMinor * it.qty) / totalUnits);
      rec.units += it.qty;
      rec.revenueUsdMinor += itemRevenue;
      rec.orders += 1;
      knownRevenue += itemRevenue;
      byProduct.set(key, rec);
    }
  }

  return [...byProduct.values()]
    .map((r) => ({
      ...r,
      revenueShare: knownRevenue > 0 ? r.revenueUsdMinor / knownRevenue : 0,
    }))
    .sort((a, b) => b.revenueUsdMinor - a.revenueUsdMinor);
}

/** Plain-language preference line for agent commentary, or null when thin. */
export function preferenceCommentary(prefs: readonly ProductPreference[]): string | null {
  if (prefs.length < 2) return null;
  const [top, second] = prefs;
  if (top.revenueShare < 0.5 || top.units < 3) return null;
  const ratio = second.revenueUsdMinor > 0 ? top.revenueUsdMinor / second.revenueUsdMinor : 0;
  const ratioText = ratio >= 2 ? ` It outsells ${second.name} ${ratio.toFixed(0)} to 1.` : "";
  return `${top.name} is what your buyers actually want — ${Math.round(top.revenueShare * 100)}% of your tracked revenue.${ratioText} I'm leaning your ads toward it.`;
}
