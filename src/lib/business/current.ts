/**
 * Which business are we looking at?
 *
 * Until now every page answered this for itself: "the oldest business this
 * user owns", written out twenty-four times. That was fine while an account
 * could only have one — and it is the reason supporting several was described
 * as a big change when the database has always allowed it. `businesses` has no
 * unique constraint on `owner_id`; only the pages assumed.
 *
 * So the assumption moves into one place. Adding a second business is now a
 * cookie and a switcher rather than an edit in twenty-four files, and the next
 * change to this rule happens once.
 *
 * SECURITY. The cookie is a hint, never an authority. It names an id, and the
 * lookup is done through the CALLER'S client so row-level security decides
 * whether they may see it. A cookie naming somebody else's business returns no
 * row and falls back to their own — the failure mode is "you see your own
 * business", not "you see a stranger's".
 */

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

export const BUSINESS_COOKIE = "glocal:business";

export interface BusinessRef {
  id: string;
  name: string;
}

/**
 * The business the user is working on.
 *
 * Falls back to their oldest, which is the one they onboarded with and the one
 * a single-business account has. `null` means they have none at all, which is
 * the pre-onboarding state and not an error.
 *
 * `columns` lets a caller fetch what it needs in the same round trip rather
 * than resolving the id and then querying again for the row.
 */
export async function currentBusiness<T = BusinessRef>(
  supabase: SupabaseClient,
  columns = "id, name",
): Promise<T | null> {
  const store = await cookies();
  const wanted = store.get(BUSINESS_COOKIE)?.value;

  if (wanted) {
    const { data } = await supabase
      .from("businesses")
      .select(columns)
      .eq("id", wanted)
      .maybeSingle();
    // No row means the cookie is stale, or names a business this user does not
    // own. Either way the answer is the same: ignore it and fall back.
    if (data) return data as T;
  }

  const { data } = await supabase
    .from("businesses")
    .select(columns)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as T) ?? null;
}

/** Everything this account owns, oldest first, for the switcher. */
export async function listBusinesses(supabase: SupabaseClient): Promise<BusinessRef[]> {
  const { data } = await supabase
    .from("businesses")
    .select("id, name")
    .order("created_at", { ascending: true });
  return (data ?? []) as BusinessRef[];
}
