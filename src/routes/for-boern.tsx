import { createFileRoute } from "@tanstack/react-router";
import { canonicalUrl } from "@/lib/canonical";
import { isMovieForChildren } from "@/lib/children-filter";
import { childrenMoviesSchemas } from "@/lib/jsonld";
import { expandShowtimeIndex } from "@/lib/public-catalog";
import { HomePage, loadCachedHomeCatalog } from "./index";

export const Route = createFileRoute("/for-boern")({
  loader: ({ context }) => loadCachedHomeCatalog(context.queryClient),
  head: ({ loaderData }) => {
    const title = "Børnefilm i biografen – Find spilletider | Lanterna";
    const description =
      "Find aktuelle børnefilm i biografen og se spilletider i hele Danmark. Filtrér på dato, tidspunkt, by og biograf.";
    const url = canonicalUrl("/for-boern");
    const image = "https://lanterna.dk/og-image.jpg";
    const screeningsByMovie = new Map<string, ReturnType<typeof expandShowtimeIndex>>();
    for (const screening of loaderData ? expandShowtimeIndex(loaderData.showtimeIndex) : []) {
      const rows = screeningsByMovie.get(screening.movieId) ?? [];
      rows.push(screening);
      screeningsByMovie.set(screening.movieId, rows);
    }
    const movies = (loaderData?.movies ?? []).filter((movie) =>
      isMovieForChildren(movie, screeningsByMovie.get(movie.id) ?? []),
    );
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
        { property: "og:image", content: image },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: image },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: childrenMoviesSchemas(movies),
    };
  },
  component: ChildrenMoviesPage,
});

function ChildrenMoviesPage() {
  return <HomePage catalog={Route.useLoaderData()} childrenOnly />;
}
