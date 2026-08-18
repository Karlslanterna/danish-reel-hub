import type { Movie } from "./cinema-data";
import { canonicalUrl } from "./canonical";
import { specialMoviesSchemas } from "./jsonld";
import { expandShowtimeIndex, type CompactShowtimeIndex } from "./public-catalog";
import { specialEventDefinition, type SpecialEventTag } from "./special-events";

type SpecialEventCatalog = {
  movies: Movie[];
  showtimeIndex: CompactShowtimeIndex;
};

export function specialEventMovies(catalog: SpecialEventCatalog | undefined, tag: SpecialEventTag) {
  if (!catalog) return [];
  const movieIds = new Set(
    expandShowtimeIndex(catalog.showtimeIndex)
      .filter((screening) => screening.events.includes(tag))
      .map((screening) => screening.movieId),
  );
  return catalog.movies.filter((movie) => movieIds.has(movie.id));
}

export function specialEventHead(catalog: SpecialEventCatalog | undefined, tag: SpecialEventTag) {
  const event = specialEventDefinition(tag);
  const movies = specialEventMovies(catalog, tag);
  const url = canonicalUrl(event.path);
  const image = "https://lanterna.dk/og-image.jpg";
  return {
    meta: [
      { title: event.title },
      { name: "description", content: event.description },
      ...(movies.length === 0 ? [{ name: "robots", content: "noindex, follow" }] : []),
      { property: "og:title", content: event.title },
      { property: "og:description", content: event.description },
      { property: "og:url", content: url },
      { property: "og:image", content: image },
      { name: "twitter:title", content: event.title },
      { name: "twitter:description", content: event.description },
      { name: "twitter:image", content: image },
    ],
    links: [{ rel: "canonical", href: url }],
    scripts: specialMoviesSchemas(event, movies),
  };
}
