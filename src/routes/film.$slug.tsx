import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { MovieDetail, type MovieDetailProgramme } from "@/components/MovieDetail";
import { fetchMovieBySlug, fetchMovieProgramme, type Movie } from "@/lib/cinema-data";
import { cityOptionsFrom } from "@/lib/city-slug";
import { canonicalUrl } from "@/lib/canonical";
import { movieSchemas } from "@/lib/jsonld";
import { movieTitle, movieDescription } from "@/lib/seo";
import { compactShowtimes } from "@/lib/public-catalog";
import { findCachedHomeMovie } from "@/lib/home-catalog-cache";

export const Route = createFileRoute("/film/$slug")({
  loader: async ({ params, context }) => {
    const movie =
      findCachedHomeMovie(context.queryClient, params.slug) ??
      (await fetchMovieBySlug(params.slug));
    if (!movie) throw notFound();
    const programme: Promise<MovieDetailProgramme> = fetchMovieProgramme(
      movie.sourceIds ?? movie.id,
    ).then(({ cinemas, showtimes }) => ({
      cinemas,
      showtimes: compactShowtimes(showtimes),
      cityOptions: cityOptionsFrom(cinemas),
    }));
    return {
      movie,
      programme,
    };
  },
  head: ({ params, loaderData }) => {
    const href = canonicalUrl(`/film/${loaderData?.movie.slug ?? params.slug}`);
    if (!loaderData)
      return {
        meta: [
          { title: "Filmen findes ikke | Lanterna" },
          { name: "robots", content: "noindex, follow" },
        ],
      };
    const { movie } = loaderData;
    const hasScreenings = (movie.screeningCount ?? 0) > 0;
    const title = movieTitle(movie.title);
    const description = movieDescription(movie.title, 0, 0);
    const image = movie.poster.url;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        // No upcoming screenings anywhere -> thin page, keep it out of the index.
        ...(hasScreenings ? [] : [{ name: "robots", content: "noindex, follow" }]),
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: href },
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
      links: [{ rel: "canonical", href: hasScreenings ? href : canonicalUrl("/film") }],
      scripts: movieSchemas(movie, [], []),
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
  const { movie, programme } = Route.useLoaderData() as {
    movie: Movie;
    programme: Promise<MovieDetailProgramme>;
  };
  return <MovieDetail movie={movie} cinemas={[]} showtimes={[]} programme={programme} />;
}
