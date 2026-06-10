import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { Poster } from "@/components/Poster";
import {
  formatRuntime,
  getCinema,
  getCinemasForMovie,
  getMovie,
  getShowtimes,
} from "@/lib/cinema-data";

export const Route = createFileRoute("/movie/$id")({
  loader: ({ params }) => {
    const movie = getMovie(params.id);
    if (!movie) throw notFound();
    return { movie };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.movie.title} — Biograf DK` },
          { name: "description", content: loaderData.movie.synopsis.slice(0, 155) },
        ]
      : [],
  }),
  notFoundComponent: () => (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-8 py-24 text-center">
        <h1 className="font-display text-4xl">Filmen findes ikke</h1>
        <Link to="/" className="mt-6 inline-block text-sm text-primary underline-offset-4 hover:underline">Tilbage til programmet</Link>
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
  const { movie } = Route.useLoaderData();
  const showtimes = getShowtimes(movie.id);
  const cinemasShowing = getCinemasForMovie(movie.id);

  // group showtimes by cinema
  const byCinema = cinemasShowing.map((c) => ({
    cinema: c,
    days: showtimes.filter((s) => s.cinemaId === c.id),
  }));

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/60">
        {/* Blurred backdrop */}
        <div
          aria-hidden
          style={{
            "--p-a": movie.poster.a,
            "--p-b": movie.poster.b,
            "--p-c": movie.poster.c,
            "--p-d": movie.poster.d,
          } as React.CSSProperties}
          className="poster-gradient absolute inset-0 scale-110 opacity-30 blur-3xl"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" />

        <div className="relative mx-auto grid max-w-[1400px] grid-cols-1 gap-12 px-8 py-16 lg:grid-cols-[340px_1fr]">
          <div>
            <Poster movie={movie} showTitle={false} className="shadow-2xl shadow-black/60" />
          </div>

          <div className="flex flex-col">
            <Link to="/" className="text-xs uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground">
              ← Tilbage
            </Link>
            <div className="mt-6 text-xs uppercase tracking-[0.25em] text-primary">
              {movie.genre.join(" · ")}
            </div>
            <h1 className="mt-3 font-display text-6xl leading-[0.95] tracking-tight text-foreground">
              {movie.title}
            </h1>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <Meta label="Instruktør" value={movie.director} />
              <Dot />
              <Meta label="Længde" value={formatRuntime(movie.runtime)} />
              <Dot />
              <Meta label="År" value={String(movie.year)} />
              <Dot />
              <Meta label="Censur" value={movie.rating} />
            </div>

            <p className="mt-8 max-w-2xl text-base leading-relaxed text-foreground/85">
              {movie.synopsis}
            </p>

            <div className="mt-10 flex flex-wrap gap-3">
              <a
                href="#showtimes"
                className="rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Se spilletider
              </a>
              <button className="rounded-md border border-border px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
                + Min liste
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Showtimes */}
      <section id="showtimes" className="mx-auto max-w-[1400px] px-8 py-16">
        <div className="mb-8 flex items-baseline justify-between">
          <h2 className="font-display text-2xl tracking-tight">Spilletider</h2>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {byCinema.length} biografer
          </div>
        </div>

        <div className="space-y-px overflow-hidden rounded-md bg-border">
          {byCinema.map(({ cinema, days }) => (
            <div key={cinema.id} className="bg-background p-6 lg:p-8">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{cinema.city}</div>
                  <Link
                    to="/cinema/$id"
                    params={{ id: cinema.id }}
                    className="mt-1 inline-block font-display text-2xl tracking-tight text-foreground hover:text-primary"
                  >
                    {cinema.name}
                  </Link>
                  <div className="mt-1 text-xs text-muted-foreground">{cinema.address}</div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {days.map((d, i) => (
                  <div key={i}>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {d.date} · {d.hall}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {d.times.map((t) => (
                        <button
                          key={t}
                          className="rounded-sm border border-border bg-card/40 px-3 py-1.5 text-sm font-medium tabular-nums text-foreground transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex flex-col">
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">{label}</span>
      <span className="text-foreground">{value}</span>
    </span>
  );
}
function Dot() {
  return <span className="text-foreground/20">·</span>;
}
