/**
 * Receipts (Phase 4). A "receipt email" is the confirmation we send after money
 * moves — a wallet top-up or a subscription charge — so the customer has a
 * record. The template is pure and tested; sending goes through Resend when
 * `RESEND_API_KEY` is set and is a silent no-op otherwise, so receipts can be
 * built and merged now and start flowing the moment the key lands. Sending must
 * NEVER break the money path, so every send helper swallows its own errors.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ReceiptInput {
  type: "topup" | "subscription";
  businessName: string;
  amountUsdMinor: number;
  /** required for subscription receipts */
  tier?: string;
  dateIso: string;
}

export interface Receipt {
  subject: string;
  text: string;
  html: string;
}

const money = (m: number) => `$${(m / 100).toFixed(2)}`;
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Pure: render the subject + text + html for a receipt. */
export function renderReceipt(input: ReceiptInput): Receipt {
  const when = new Date(input.dateIso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  if (input.type === "subscription") {
    const tier = input.tier ? titleCase(input.tier) : "subscription";
    const subject = `Your Glocal ${tier} plan is active`;
    const text = [
      `Hi ${input.businessName},`,
      ``,
      `Thanks for subscribing to Glocal ${tier}.`,
      `Amount: ${money(input.amountUsdMinor)} per month`,
      `Date: ${when}`,
      ``,
      `Your plan is active now. You can render, launch, and manage everything from your dashboard.`,
      ``,
      `— Glocal`,
    ].join("\n");
    return { subject, text, html: textToHtml(text) };
  }

  const subject = `Your Glocal wallet top-up of ${money(input.amountUsdMinor)}`;
  const text = [
    `Hi ${input.businessName},`,
    ``,
    `We've added ${money(input.amountUsdMinor)} to your Glocal wallet.`,
    `Date: ${when}`,
    ``,
    `Every dollar sits in your wallet, ready for ads. Unspent balance is always refundable.`,
    ``,
    `— Glocal`,
  ].join("\n");
  return { subject, text, html: textToHtml(text) };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textToHtml(text: string): string {
  const body = text
    .split("\n")
    .map((line) => (line === "" ? "<br/>" : `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`))
    .join("");
  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#111">${body}</div>`;
}

/**
 * Send a rendered receipt via Resend. No-op (never throws) when RESEND_API_KEY
 * is unset, so the money path is unaffected before the email key is added.
 */
export async function sendReceiptEmail(
  to: string,
  receipt: Receipt,
): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "no RESEND_API_KEY" };
  const from = process.env.RECEIPT_FROM_EMAIL ?? "Glocal <receipts@useglocal.ai>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: receipt.subject, text: receipt.text, html: receipt.html }),
    });
    return res.ok ? { sent: true } : { sent: false, reason: `resend ${res.status}` };
  } catch (e) {
    return { sent: false, reason: (e as Error).message };
  }
}

/**
 * Best-effort: resolve the business owner's email (service-role) and send the
 * receipt. Never throws — a failed lookup or send just returns { sent: false }.
 * Called after a successful charge in the webhook.
 */
export async function sendReceiptForBusiness(
  supabase: SupabaseClient,
  businessId: string,
  input: { type: "topup" | "subscription"; amountUsdMinor: number; tier?: string },
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const { data: biz } = await supabase
      .from("businesses")
      .select("name, owner_id")
      .eq("id", businessId)
      .maybeSingle();
    if (!biz?.owner_id) return { sent: false, reason: "no owner" };

    const { data: userRes } = await supabase.auth.admin.getUserById(biz.owner_id as string);
    const email = userRes?.user?.email;
    if (!email) return { sent: false, reason: "no email" };

    const receipt = renderReceipt({
      type: input.type,
      amountUsdMinor: input.amountUsdMinor,
      tier: input.tier,
      businessName: (biz.name as string) ?? "there",
      dateIso: new Date().toISOString(),
    });
    return await sendReceiptEmail(email, receipt);
  } catch (e) {
    return { sent: false, reason: (e as Error).message };
  }
}
