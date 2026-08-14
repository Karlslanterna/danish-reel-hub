import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Poster } from "@/components/Poster";
import { fetchMovies, fetchCinemas, type Movie, type Cinema } from "@/lib/cinema-data";
import { canonicalUrl } from "@/lib/canonical";
import { indexTitle, indexDescription } from "@/lib/seo";

export const Route = createFileRoute("/film/")({
  loader: async () => {
    const [movies, cinemas] = await Promise.all([fetchMovies(), fetchCinemas()]);
    return { movies, cinemas };
  },
  head: ({ loaderData }) => {
    const href = canonicalUrl("/film");
    const title = indexTitle("film");
    const description = indexDescription("film");
    void loaderData;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: href },
        { property: "og:type", content: "website" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href }],
    };
  },
  errorComponent: ({ reset }) => (
    <div className="p-12">
      <button onClick={reset} className="text-primary">Prøv igen</button>
    </div>
  ),
  component: FilmIndexPage,
});

function FilmIndexPage() {
  const { movies, cinemas } = Route.useLoaderData() as { movies: Movie[]; cinemas: Cinema[] };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <section className="mx-auto max-w-[1400px] px-6 py-10 sm:px-8 sm:py-14">
        <Breadcrumb items={[{ label: "Forside", to: "/" }, { label: "Film" }]} />
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Alle film i biografen
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          {movies.length} film på plakaten i danske biografer. Vælg en film for at se spilletider og
          købe billetter.
        </p>

        <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
          {movies.map((m) => (
            <Link key={m.id} to="/film/$slug" params={{ slug: m.slug }} className="group block">
              <Poster movie={m} showTitle={false} sizes="(min-width: 1024px) 220px, 45vw" />
              <div className="mt-2 line-clamp-2 text-sm text-foreground group-hover:text-primary">
                {m.title}
              </div>
            </Link>
          ))}
        </div>
      </section>
      <SiteFooter cinemas={cinemas} />
    </div>
  );
}
