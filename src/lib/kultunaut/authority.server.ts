import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Cinema ownership follows the permanent eBillet link, never current
 * availability. Kultunaut must not mutate or promote screenings into any of
 * these canonical cinema ids.
 */
export async function loadEbilletOwnedCinemaIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const [linked, organizers] = await Promise.all([
    supabaseAdmin.from("cinemas").select("id").not("ebillet_organizer_id", "is", null),
    supabaseAdmin.from("ebillet_organizers").select("cinema_id").not("cinema_id", "is", null),
  ]);
  if (linked.error) throw new Error(`ebillet coverage: ${linked.error.message}`);
  if (organizers.error) throw new Error(`ebillet coverage: ${organizers.error.message}`);
  for (const row of linked.data ?? []) ids.add(row.id);
  for (const row of organizers.data ?? []) if (row.cinema_id) ids.add(row.cinema_id);
  return ids;
}
