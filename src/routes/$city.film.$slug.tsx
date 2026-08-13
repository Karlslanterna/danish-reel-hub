import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { MovieDetail } from "@/components/MovieDetail";
import { useFilters } from "@/lib/filters";
import {
  fetchMovieBySlug,
  fetchCinemasForMovie,
  fetchShowtimesForMovie,
  type Movie,
  type Cinema,
  type Showtime,
} from "@/lib/cinema-data";
import { baseCityOf, cityMatchesSlug, cityOptionsFrom, citySlug, type CityOption } from "@/lib/city-slug";
import { canonicalUrl } from "@/lib/canonical";
import { movieSchemas } from "@/lib/jsonld";

export const Route = createFileRoute("/$city/film/$slug")({
  loader: async ({ params }) => {
    const slug = params.city.toLowerCase();
    const movie = await fetchMovieBySlug(params.slug);
    if (!movie) throw notFound();
    const [allCinemas, showtimes] = await Promise.all([
      fetchCinemasForMovie(movie.id),
      fetchShowtimesForMovie(movie.id),
    ]);
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
        showtimes: [],
        cityName: baseCityOf(match.city),
        canonicalSlug: citySlug(match.city),
        cityOptions,
      };
    }
    const cityName = cinemas.length > 0 ? baseCityOf(cinemas[0].city) : (cityOptions.find((c) => c.slug === slug)?.name ?? slug);
    const canonicalSlug = cinemas.length > 0 ? citySlug(cinemas[0].city) : slug;
    const cinemaIds = new Set(cinemas.map((c) => c.id));
    return {
      movie,
      cinemas,
      showtimes: showtimes.filter((s) => cinemaIds.has(s.cinemaId)),
      cityName,
      canonicalSlug,
      cityOptions,
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Filmen findes ikke — Lanterna" }, { name: "robots", content: "noindex" }] };
    const { movie, cityName, canonicalSlug, cinemas, showtimes } = loaderData;
    const href = canonicalUrl(`/${canonicalSlug}/film/${movie.slug}`);
    // Canonical points at the national movie page: the city variants are
    // near-duplicates of the same film content and should consolidate their
    // signals, while city landing pages (/koebenhavn) rank on their own.
    const canonical = canonicalUrl(`/film/${movie.slug}`);
    const title = `${movie.title} i ${cityName} | LANTERNA`;
    const description =
      `Se spilletider for ${movie.title} i ${cityName}. ${cinemas.length} ${cinemas.length === 1 ? "biograf" : "biografer"} — book billetter direkte.`.slice(0, 158);
    const image = movie.poster.url;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: href },
        { property: "og:type", content: "video.movie" },
        ...(image ? [{ property: "og:image", content: image }, { name: "twitter:image", content: image }] : []),
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
        <Link to="/" className="mt-6 inline-block text-sm text-primary underline-offset-4 hover:underline">Tilbage</Link>
      </div>
    </div>
  ),
  errorComponent: ({ reset }) => (
    <div className="p-12">
      <button onClick={reset} className="text-primary">Prøv igen</button>
    </div>
  ),
  component: CityMoviePage,
});

function CityMoviePage() {
  const { movie, cinemas, showtimes, cityName, canonicalSlug, cityOptions } = Route.useLoaderData() as {
    movie: Movie;
    cinemas: Cinema[];
    showtimes: Showtime[];
    cityName: string;
    canonicalSlug: string;
    cityOptions: CityOption[];
  };
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
