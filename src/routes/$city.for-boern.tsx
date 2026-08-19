import { createFileRoute } from "@tanstack/react-router";
import { canonicalUrl } from "@/lib/canonical";
import { isMovieForChildren } from "@/lib/children-filter";
import { childrenMoviesSchemas } from "@/lib/jsonld";
import { expandShowtimeIndex } from "@/lib/public-catalog";
import { CityPage, loadCityCatalog } from "./$city.index";

export const Route = createFileRoute("/$city/for-boern")({
  loader: ({ params }) => loadCityCatalog(params.city),
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ name: "robots", content: "noindex, follow" }] };
    const showtimes = expandShowtimeIndex(loaderData.showtimes);
    const screeningsByMovie = new Map<string, typeof showtimes>();
    for (const screening of showtimes) {
      const rows = screeningsByMovie.get(screening.movieId) ?? [];
      rows.push(screening);
      screeningsByMovie.set(screening.movieId, rows);
    }
    const movies = loaderData.movies.filter((movie) =>
      isMovieForChildren(movie, screeningsByMovie.get(movie.id) ?? []),
    );
    const path = `/${loaderData.canonicalSlug}/for-boern`;
    const title = `Børnefilm i ${loaderData.cityName} – Se spilletider | Lanterna`;
    const description = `Find ${movies.length} aktuelle børnefilm i ${loaderData.cityName}. Se datoer, tidspunkter og biografer, og køb billetter direkte.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...(movies.length < 2 ? [{ name: "robots", content: "noindex, follow" }] : []),
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonicalUrl(path) },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href: canonicalUrl(path) }],
      scripts: childrenMoviesSchemas(movies, {
        path,
        name: `Børnefilm i ${loaderData.cityName}`,
        description,
      }),
    };
  },
  component: CityChildrenPage,
});

function CityChildrenPage() {
  return <CityPage data={Route.useLoaderData()} fixedChildrenOnly />;
}
