import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { Poster } from "@/components/Poster";
import { FilterBar, useFilters, fmtDateLabel } from "@/lib/filters";
import {
  fetchCinemaBySlug,
  fetchMoviesAndShowtimesForCinemas,
  formatRuntime,
  type Cinema,
  type Movie,
  type Showtime,
} from "@/lib/cinema-data";

export const Route = createFileRoute("/biograf/$slug")({
  loader: async ({ params }) => {
    const cinema = await fetchCinemaBySlug(params.slug);
    if (!cinema) throw notFound();
    const { movies, showtimes } = await fetchMoviesAndShowtimesForCinemas([cinema.id]);
    movies.sort((a, b) => a.title.localeCompare(b.title, "da"));
    return { cinema, movies, showtimes };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.cinema.name}, ${loaderData.cinema.city} — Lanterna` },
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

const todayStr = () => new Date().toISOString().split("T")[0];

function CinemaPage() {
  const { cinema, movies, showtimes } = Route.useLoaderData() as {
    cinema: Cinema;
    movies: Movie[];
    showtimes: Showtime[];
  };
  const { selectedDate, clear } = useFilters();
  const activeDate = selectedDate ?? todayStr();

  const showtimesByMovie = new Map<string, Showtime[]>();
  for (const s of showtimes) {
    if (s.date !== activeDate) continue;
    const arr = showtimesByMovie.get(s.movieId) ?? [];
    arr.push(s);
    showtimesByMovie.set(s.movieId, arr);
  }

  const rows = movies
    .map((m) => ({ movie: m, shows: showtimesByMovie.get(m.id) ?? [] }))
    .sort((a, b) => (b.shows.length > 0 ? 1 : 0) - (a.shows.length > 0 ? 1 : 0));

  const withShows = rows.filter((r) => r.shows.length > 0);
  const withoutShows = rows.filter((r) => r.shows.length === 0);

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
              <div className="text-xs uppercase tracking-[0.25em] text-primary">{cinema.city.replace(/^\s*\d{3,4}\s+/u, "").trim()}</div>
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
              <InfoRow label="Film på plakaten" value={`${movies.length}`} />
              <InfoRow label="Telefon" value="+45 33 15 16 11" />
              <InfoRow label="Åbningstider" value="Dagligt 14:00 — 23:30" />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-8 py-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <h2 className="font-display text-2xl tracking-tight">Film på plakaten</h2>
            <FilterBar hideRadius />
            {selectedDate && (
              <button
                type="button"
                onClick={clear}
                className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Ryd filtre
              </button>
            )}
          </div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {withShows.length} film · {fmtDateLabel(activeDate)}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-16 text-center">
            <p className="font-display text-xl text-foreground">Ingen film på plakaten</p>
          </div>
        ) : (
          <div className="space-y-px overflow-hidden rounded-md bg-border">
            {withShows.map(({ movie, shows }) => (
              <MovieRow key={movie.id} movie={movie} shows={shows} />
            ))}
            {withoutShows.length > 0 && (
              <div className="bg-background px-6 py-4 lg:px-8">
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Ingen forestillinger {fmtDateLabel(activeDate).toLowerCase()}
                </div>
              </div>
            )}
            {withoutShows.map(({ movie }) => (
              <MovieRow key={movie.id} movie={movie} shows={[]} dim />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MovieRow({ movie, shows, dim = false }: { movie: Movie; shows: Showtime[]; dim?: boolean }) {
  return (
    <div className={`bg-background p-6 lg:p-8 ${dim ? "opacity-60" : ""}`}>
      <div className="grid grid-cols-[120px_1fr] gap-6 md:grid-cols-[180px_1fr] md:gap-10">
        <Link to="/film/$slug" params={{ slug: movie.slug }} className="block">
          <Poster movie={movie} showTitle={false} />
        </Link>

        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-primary">{movie.genre.join(" · ")}</div>
          <Link
            to="/film/$slug"
            params={{ slug: movie.slug }}
            className="mt-1 inline-block font-display text-2xl tracking-tight text-foreground hover:text-primary"
          >
            {movie.title}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{formatRuntime(movie.runtime)}</span>
            <span className="text-foreground/20">·</span>
            <span>{movie.year}</span>
            <span className="text-foreground/20">·</span>
            <span>Censur {movie.rating}</span>
          </div>
          <p className="mt-3 line-clamp-2 max-w-prose text-sm text-foreground/75">{movie.synopsis}</p>

          <div className="mt-5">
            {shows.length === 0 ? (
              <div className="text-xs text-muted-foreground">Ingen forestillinger denne dag</div>
            ) : (
              <div className="space-y-3">
                {shows.map((s, i) => (
                  <div key={i}>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{s.hall}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {s.times.map((t, idx) => {
                        const url = s.ticketUrls?.[idx] || s.bookingUrl;
                        return url ? (
                          <a
                            key={t + idx}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium tabular-nums text-primary-foreground transition-colors hover:bg-primary/90"
                          >
                            {t}
                          </a>
                        ) : (
                          <span
                            key={t + idx}
                            className="rounded-sm border border-border bg-card/40 px-3 py-1.5 text-sm font-medium tabular-nums text-muted-foreground"
                          >
                            {t}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
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
