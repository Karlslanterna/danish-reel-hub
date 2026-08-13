import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { MovieDetail } from "@/components/MovieDetail";
import {
  fetchMovieBySlug,
  fetchCinemasForMovie,
  fetchShowtimesForMovie,
  type Movie,
  type Cinema,
  type Showtime,
} from "@/lib/cinema-data";
import { cityOptionsFrom, type CityOption } from "@/lib/city-slug";
import { canonicalUrl } from "@/lib/canonical";
import { movieSchemas } from "@/lib/jsonld";

export const Route = createFileRoute("/film/$slug")({
  loader: async ({ params }) => {
    const movie = await fetchMovieBySlug(params.slug);
    if (!movie) throw notFound();
    const [cinemas, showtimes] = await Promise.all([
      fetchCinemasForMovie(movie.id),
      fetchShowtimesForMovie(movie.id),
    ]);
    return { movie, cinemas, showtimes, cityOptions: cityOptionsFrom(cinemas) };
  },
  head: ({ params, loaderData }) => {
    const href = canonicalUrl(`/film/${params.slug}`);
    if (!loaderData) return { meta: [], links: [], scripts: [] };
    const title = `${loaderData.movie.title} — Lanterna`;
    const description = loaderData.movie.synopsis.slice(0, 155);
    const image = loaderData.movie.poster.url;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: href },
        { property: "og:type", content: "video.movie" },
        ...(image ? [
          { property: "og:image", content: image },
          { name: "twitter:image", content: image },
        ] : []),
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href }],
      scripts: movieSchemas(loaderData.movie, loaderData.cinemas, loaderData.showtimes),
    };
  },
  notFoundComponent: () => (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-8 py-24 text-center">
        <h1 className="font-display text-4xl">Filmen findes ikke</h1>
        <Link to="/" className="mt-6 inline-block text-sm text-primary underline-offset-4 hover:underline">Tilbage</Link>
      </div>
    </div>
  ),
  errorComponent: ({ reset }) => (
    <div className="p-12">
      <button onClick={reset} className="text-primary">Prøv igen</button>
    </div>
  ),
  component: MoviePage,
});

function MoviePage() {
  const { movie, cinemas, showtimes, cityOptions } = Route.useLoaderData() as {
    movie: Movie;
    cinemas: Cinema[];
    showtimes: Showtime[];
    cityOptions: CityOption[];
  };
  return <MovieDetail movie={movie} cinemas={cinemas} showtimes={showtimes} cityOptions={cityOptions} />;
}
