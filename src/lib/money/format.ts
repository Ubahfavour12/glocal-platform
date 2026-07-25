/**
 * Money formatting for the dashboard (Phase 3).
 * USD is canonical; when a local rate + symbol are known we append a local
 * equivalent so the app reads multinational (USD anchor, local aside).
 */

/** USD from minor units, e.g. 12345 -> "$123.45". */
export function fmtUsd(minor: number): string {
  return `$${(minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Local equivalent of a USD-minor amount at `rate` (local per USD). */
export function fmtLocal(usdMinor: number, rate: number, symbol: string): string {
  const localMajor = (usdMinor / 100) * rate;
  return `${symbol}${Math.round(localMajor).toLocaleString("en-US")}`;
}

/** USD with an optional local equivalent in parentheses. */
export function fmtDual(
  usdMinor: number,
  local?: { rate: number; symbol: string; currency: string } | null,
): string {
  const usd = fmtUsd(usdMinor);
  if (!local || local.currency === "USD") return usd;
  return `${usd} (${fmtLocal(usdMinor, local.rate, local.symbol)})`;
}

/** Return on ad spend, one decimal, or a dash when there is no spend yet. */
export function fmtRoas(revenueUsdMinor: number, spendUsdMinor: number): string {
  if (spendUsdMinor <= 0) return "—";
  return `${(revenueUsdMinor / spendUsdMinor).toFixed(1)}x`;
}
