import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { MovieDetail } from "@/components/MovieDetail";
import {
  fetchMovieBySlug,
  fetchMovieProgramme,
  type Movie,
  type Cinema,
  type Showtime,
} from "@/lib/cinema-data";
import { cityOptionsFrom, type CityOption } from "@/lib/city-slug";
import { canonicalUrl } from "@/lib/canonical";
import { movieSchemas } from "@/lib/jsonld";
import { movieTitle, movieDescription } from "@/lib/seo";
import { compactShowtimes, expandShowtimes, type CompactShowtimes } from "@/lib/public-catalog";
import { findCachedHomeMovie } from "@/lib/home-catalog-cache";

export const Route = createFileRoute("/film/$slug")({
  loader: async ({ params, context }) => {
    const movie =
      findCachedHomeMovie(context.queryClient, params.slug) ??
      (await fetchMovieBySlug(params.slug));
    if (!movie) throw notFound();
    const { cinemas, showtimes } = await fetchMovieProgramme(movie.sourceIds ?? movie.id);
    return {
      movie,
      cinemas,
      showtimes: compactShowtimes(showtimes),
      cityOptions: cityOptionsFrom(cinemas),
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData)
      return {
        meta: [
          { title: "Filmen findes ikke | Lanterna" },
          { name: "robots", content: "noindex, follow" },
        ],
      };
    const { movie, cinemas, cityOptions } = loaderData;
    const showtimes = expandShowtimes(loaderData.showtimes);
    const canonical = canonicalUrl(`/film/${movie.slug}`);
    const title = movieTitle(movie.title);
    const description = movieDescription(movie.title, cinemas.length, cityOptions.length);
    const image = movie.poster.url;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...(showtimes.length > 0 ? [] : [{ name: "robots", content: "noindex, follow" }]),
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonical },
        { property: "og:type", content: "video.movie" },
        ...(image
          ? [
              { property: "og:image", content: image },
              { name: "twitter:image", content: image },
            ]
          : []),
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href: canonical }],
      scripts: movieSchemas(movie, cinemas, showtimes),
    };
  },
  notFoundComponent: () => (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-8 py-24 text-center">
        <h1 className="font-display text-4xl">Filmen findes ikke</h1>
        <Link
          to="/"
          className="mt-6 inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          Tilbage
        </Link>
      </div>
    </div>
  ),
  errorComponent: ({ reset }) => (
    <div className="p-12">
      <button onClick={reset} className="text-primary">
        Prøv igen
      </button>
    </div>
  ),
  component: MoviePage,
});

function MoviePage() {
  const {
    movie,
    cinemas,
    showtimes: compact,
    cityOptions,
  } = Route.useLoaderData() as {
    movie: Movie;
    cinemas: Cinema[];
    showtimes: CompactShowtimes;
    cityOptions: CityOption[];
  };
  const showtimes: Showtime[] = useMemo(() => expandShowtimes(compact), [compact]);

  return (
    <MovieDetail
      movie={movie}
      cinemas={cinemas}
      showtimes={showtimes}
      cityOptions={cityOptions}
    />
  );
}
