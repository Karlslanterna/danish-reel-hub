import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { MovieDetail } from "@/components/MovieDetail";
import { useFilters } from "@/lib/filters";
import {
  fetchMovieBySlug,
  fetchMovieProgramme,
  type Movie,
  type Cinema,
  type Showtime,
} from "@/lib/cinema-data";
import {
  baseCityOf,
  cityMatchesSlug,
  cityOptionsFrom,
  citySlug,
  type CityOption,
} from "@/lib/city-slug";
import { canonicalUrl } from "@/lib/canonical";
import { movieSchemas } from "@/lib/jsonld";
import { cityMovieTitle, cityMovieDescription } from "@/lib/seo";
import { compactShowtimes, expandShowtimes, type CompactShowtimes } from "@/lib/public-catalog";
import { findCachedHomeMovie } from "@/lib/home-catalog-cache";

export const Route = createFileRoute("/$city/film/$slug")({
  loader: async ({ params, context }) => {
    const slug = params.city.toLowerCase();
    const movie =
      findCachedHomeMovie(context.queryClient, params.slug) ??
      (await fetchMovieBySlug(params.slug));
    if (!movie) throw notFound();
    const { cinemas: allCinemas, showtimes } = await fetchMovieProgramme(
      movie.sourceIds ?? movie.id,
    );
    const cityOptions = cityOptionsFrom(allCinemas);
    const cinemas = allCinemas.filter((c) => cityMatchesSlug(c.city, slug));
    // Unknown city slug (no cinema anywhere matches) -> 404. A known city with
    // no screenings for this movie still renders, with a link to the national page.
    const known = cinemas.length > 0 || cityOptions.some((c) => c.slug === slug);
    if (!known) {
      const { fetchCinemas } = await import("@/lib/cinema-data");
      const all = await fetchCinemas();
      const match = all.find((c) => cityMatchesSlug(c.city, slug));
      if (!match) throw notFound();
      return {
        movie,
        cinemas: [],
        showtimes: compactShowtimes([]),
        cityName: baseCityOf(match.city),
        canonicalSlug: citySlug(match.city),
        cityOptions,
      };
    }
    const cityName =
      cinemas.length > 0
        ? baseCityOf(cinemas[0].city)
        : (cityOptions.find((c) => c.slug === slug)?.name ?? slug);
    const canonicalSlug = cinemas.length > 0 ? citySlug(cinemas[0].city) : slug;
    const cinemaIds = new Set(cinemas.map((c) => c.id));
    return {
      movie,
      cinemas,
      showtimes: compactShowtimes(showtimes.filter((s) => cinemaIds.has(s.cinemaId))),
      cityName,
      canonicalSlug,
      cityOptions,
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
    const { movie, cityName, canonicalSlug, cinemas } = loaderData;
    const showtimes = expandShowtimes(loaderData.showtimes);
    const selfHref = canonicalUrl(`/${canonicalSlug}/film/${movie.slug}`);
    const nationalHref = canonicalUrl(`/film/${movie.slug}`);
    // Thin-content protection: a city page with no upcoming screenings adds no
    // value to the index, so it stays crawlable but points its signals at the
    // national movie page. With screenings it is genuinely unique and
    // self-canonical.
    const hasScreenings = showtimes.length > 0;
    const canonical = hasScreenings ? selfHref : nationalHref;
    const title = cityMovieTitle(movie.title, cityName);
    const description = cityMovieDescription(movie.title, cityName, cinemas.length);
    const image = movie.poster.url;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...(hasScreenings ? [] : [{ name: "robots", content: "noindex, follow" }]),
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
        <h1 className="font-display text-4xl">Siden findes ikke</h1>
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
  component: CityMoviePage,
});

function CityMoviePage() {
  const {
    movie,
    cinemas,
    showtimes: compact,
    cityName,
    canonicalSlug,
    cityOptions,
  } = Route.useLoaderData() as {
    movie: Movie;
    cinemas: Cinema[];
    showtimes: CompactShowtimes;
    cityName: string;
    canonicalSlug: string;
    cityOptions: CityOption[];
  };
  const showtimes: Showtime[] = useMemo(() => expandShowtimes(compact), [compact]);
  const { selectedCity, setSelectedCity } = useFilters();

  useEffect(() => {
    if (selectedCity !== cityName) setSelectedCity(cityName);
  }, [cityName, selectedCity, setSelectedCity]);

  return (
    <MovieDetail
      movie={movie}
      cinemas={cinemas}
      showtimes={showtimes}
      city={{ name: cityName, slug: canonicalSlug }}
      cityOptions={cityOptions}
    />
  );
}
