import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Cinema } from "@/lib/cinema-data";
import type { CompactShowtimes } from "@/lib/public-catalog";

export type PublicMovieProgramme = {
  cinemas: Cinema[];
  showtimes: CompactShowtimes;
};

/**
 * Keep the large raw screening read between Lanterna's server and Supabase.
 * Mobile clients receive one compact response instead of downloading and
 * grouping thousands of physical screening rows themselves.
 */
export const getPublicMovieProgramme = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      movieIds: z
        .array(
          z
            .string()
            .min(1)
            .max(160)
            .regex(/^[A-Za-z0-9_-]+$/),
        )
        .min(1)
        .max(20),
    }),
  )
  .handler(async ({ data }): Promise<PublicMovieProgramme> => {
    const [{ fetchMovieProgramme }, { compactShowtimes }] = await Promise.all([
      import("@/lib/cinema-data"),
      import("@/lib/public-catalog"),
    ]);
    const programme = await fetchMovieProgramme(data.movieIds);
    return {
      cinemas: programme.cinemas,
      showtimes: compactShowtimes(programme.showtimes),
    };
  });
