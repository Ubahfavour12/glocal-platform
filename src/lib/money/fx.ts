/**
 * FX engine — Blueprint §5.2.
 * Ad networks bill in USD; customers fund in local currency. Rates refresh
 * hourly; a 3% protective buffer is absorbed into the displayed rate so the
 * customer always sees the final price before confirming.
 *
 * All amounts are integer minor units (cents, kobo). No floats in balances.
 */

export const FX_BUFFER_BPS = 300; // 3% protective buffer, in basis points
export const RATE_MAX_AGE_MS = 90 * 60 * 1000; // refreshed hourly; stale past 90min

export interface RateSnapshot {
  /** ISO currency code the customer pays in, e.g. "NGN" */
  quote: string;
  /** Market rate: quote units per 1 USD */
  rate: number;
  /** When the rate was fetched */
  fetchedAt: Date;
}

export class StaleRateError extends Error {
  constructor(snapshot: RateSnapshot) {
    super(
      `FX rate for ${snapshot.quote} fetched at ${snapshot.fetchedAt.toISOString()} is stale`,
    );
    this.name = "StaleRateError";
  }
}

export function isStale(snapshot: RateSnapshot, now: Date = new Date()): boolean {
  return now.getTime() - snapshot.fetchedAt.getTime() > RATE_MAX_AGE_MS;
}

/**
 * The rate the customer actually pays: market rate plus the 3% buffer.
 * (Customer pays MORE local currency per USD, protecting the platform
 * against swings between top-up and spend.)
 */
export function effectiveRate(snapshot: RateSnapshot): number {
  if (!(snapshot.rate > 0)) throw new Error("FX rate must be positive");
  return snapshot.rate * (1 + FX_BUFFER_BPS / 10_000);
}

/**
 * How much local currency (minor units) buys the given USD amount.
 * Rounds UP so the platform never undercollects.
 */
export function localCostForUsd(
  usdMinor: number,
  snapshot: RateSnapshot,
  now: Date = new Date(),
): number {
  assertMinor(usdMinor);
  if (isStale(snapshot, now)) throw new StaleRateError(snapshot);
  return Math.ceil(usdMinor * effectiveRate(snapshot));
}

/**
 * USD credit (minor units) for a local-currency payment.
 * Rounds DOWN so the ledger never over-credits.
 */
export function usdCreditForLocal(
  localMinor: number,
  snapshot: RateSnapshot,
  now: Date = new Date(),
): number {
  assertMinor(localMinor);
  if (isStale(snapshot, now)) throw new StaleRateError(snapshot);
  return Math.floor(localMinor / effectiveRate(snapshot));
}

function assertMinor(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`amount must be a non-negative integer of minor units, got ${amount}`);
  }
}
