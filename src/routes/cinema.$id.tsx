import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { MovieCard } from "@/components/MovieCard";
import { getCinema, getMoviesByIds } from "@/lib/cinema-data";

export const Route = createFileRoute("/cinema/$id")({
  loader: ({ params }) => {
    const cinema = getCinema(params.id);
    if (!cinema) throw notFound();
    return { cinema, movies: getMoviesByIds(cinema.movieIds) };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.cinema.name}, ${loaderData.cinema.city} — Biograf DK` },
          { name: "description", content: loaderData.cinema.description.slice(0, 155) },
        ]
      : [],
  }),
  notFoundComponent: () => (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-8 py-24 text-center">
        <h1 className="font-display text-4xl">Biografen findes ikke</h1>
        <Link to="/" className="mt-6 inline-block text-sm text-primary underline-offset-4 hover:underline">Tilbage</Link>
      </div>
    </div>
  ),
  errorComponent: ({ reset }) => (
    <div className="p-12">
      <button onClick={reset} className="text-primary">Prøv igen</button>
    </div>
  ),
  component: CinemaPage,
});

function CinemaPage() {
  const { cinema, movies } = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-8 py-16">
          <Link to="/" className="text-xs uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground">
            ← Alle biografer
          </Link>

          <div className="mt-8 grid grid-cols-1 gap-12 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-primary">{cinema.city}</div>
              <h1 className="mt-3 font-display text-7xl leading-[0.9] tracking-tight text-foreground">
                {cinema.name}
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-foreground/85">
                {cinema.description}
              </p>
            </div>

            <div className="space-y-px overflow-hidden rounded-md bg-border self-start">
              <InfoRow label="Adresse" value={cinema.address} />
              <InfoRow label="Antal sale" value={`${cinema.screens}`} />
              <InfoRow label="Film på plakaten" value={`${cinema.movieIds.length}`} />
              <InfoRow label="Telefon" value="+45 33 15 16 11" />
              <InfoRow label="Åbningstider" value="Dagligt 14:00 — 23:30" />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-8 py-16">
        <div className="mb-8 flex items-baseline justify-between">
          <h2 className="font-display text-2xl tracking-tight">På programmet nu</h2>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {movies.length} film
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {movies.map((m) => (
            <MovieCard key={m.id} movie={m} />
          ))}
        </div>
      </section>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 bg-background p-5">
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <span className="text-right text-sm text-foreground">{value}</span>
    </div>
  );
}
