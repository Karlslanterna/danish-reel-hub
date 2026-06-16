import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { MovieCard } from "@/components/MovieCard";
import { fetchCinemas, fetchMoviesForCinema, type Cinema, type Movie } from "@/lib/cinema-data";

export const Route = createFileRoute("/by/$city")({
  loader: async ({ params }) => {
    const all = await fetchCinemas();
    const citySlug = params.city.toLowerCase();
    const baseOf = (s: string) => s.replace(/\s+[A-ZÆØÅ]{1,3}$/u, "").trim().toLowerCase();
    const cinemas = all.filter(
      (c) => c.city.toLowerCase() === citySlug || baseOf(c.city) === citySlug,
    );
    if (cinemas.length === 0) throw notFound();
    const programs = await Promise.all(
      cinemas.map(async (c) => ({ cinema: c, movies: await fetchMoviesForCinema(c.id) })),
    );
    const bases = new Set(cinemas.map((c) => baseOf(c.city)));
    const displayCity = bases.size === 1 ? cinemas[0].city.replace(/\s+[A-ZÆØÅ]{1,3}$/u, "").trim() : cinemas[0].city;
    return { city: displayCity, programs };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `Biografer i ${loaderData.city} — Lanterna` },
          { name: "description", content: `Find biografer og film i ${loaderData.city}.` },
        ]
      : [],
  }),
  notFoundComponent: () => (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-8 py-24 text-center">
        <h1 className="font-display text-4xl">Ingen biografer i denne by</h1>
        <Link to="/" className="mt-6 inline-block text-sm text-primary underline-offset-4 hover:underline">
          Tilbage
        </Link>
      </div>
    </div>
  ),
  errorComponent: ({ reset }) => (
    <div className="p-12">
      <button onClick={reset} className="text-primary">Prøv igen</button>
    </div>
  ),
  component: CityPage,
});

function CityPage() {
  const { city, programs } = Route.useLoaderData() as {
    city: string;
    programs: { cinema: Cinema; movies: Movie[] }[];
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-8 py-16">
          <Link to="/" className="text-xs uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground">
            ← Forside
          </Link>
          <div className="mt-6 text-xs uppercase tracking-[0.25em] text-primary">By</div>
          <h1 className="mt-3 font-display text-7xl font-bold leading-[0.9] tracking-tight text-foreground">
            {city}
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            {programs.length} {programs.length === 1 ? "biograf" : "biografer"} · dagens program
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-[1400px] space-y-16 px-8 py-16">
        {programs.map(({ cinema, movies }) => (
          <section key={cinema.id}>
            <div className="mb-6 flex items-baseline justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{cinema.city}</div>
                <Link
                  to="/biograf/$slug"
                  params={{ slug: cinema.slug }}
                  className="mt-1 inline-block font-display text-3xl tracking-tight text-foreground hover:text-primary"
                >
                  {cinema.name}
                </Link>
              </div>
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{movies.length} film</div>
            </div>
            {movies.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ingen film på plakaten lige nu.</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {movies.map((m) => (
                  <MovieCard key={m.id} movie={m} />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
