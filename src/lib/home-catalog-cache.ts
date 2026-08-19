import type { QueryClient } from "@tanstack/react-query";
import type { Movie } from "@/lib/cinema-data";

export const HOME_CATALOG_QUERY_KEY = ["public-home-catalog"] as const;

type CachedHomeCatalog = { movies: Movie[] };

export function findCachedHomeMovie(
  queryClient: Pick<QueryClient, "getQueryData">,
  slug: string,
): Movie | null {
  const catalog = queryClient.getQueryData<CachedHomeCatalog>(HOME_CATALOG_QUERY_KEY);
  return (
    catalog?.movies.find((movie) => (movie.sourceSlugs ?? [movie.slug]).includes(slug)) ?? null
  );
}
