import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { Poster } from "@/components/Poster";
import {
  formatRuntime,
  fetchMovieBySlug,
  fetchCinemasForMovie,
  fetchShowtimesForMovie,
  type Movie,
  type Cinema,
  type Showtime,
} from "@/lib/cinema-data";

type FilmSearch = {
  date?: string;
  radius?: number | "all";
  lat?: number;
  lng?: number;
};

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const TODAY = new Date().toISOString().split("T")[0];
const TOMORROW = new Date(Date.now() + 86400000).toISOString().split("T")[0];

function fmtDateLabel(date: string) {
  if (date === TODAY) return "I dag";
  if (date === TOMORROW) return "I morgen";
  return new Date(date + "T12:00:00").toLocaleDateString("da-DK", { day: "numeric", month: "short" });
}

export const Route = createFileRoute("/film/$slug")({
  validateSearch: (s: Record<string, unknown>): FilmSearch => {
    const out: FilmSearch = {};
    if (typeof s.date === "string") out.date = s.date;
    if (s.radius === "all") out.radius = "all";
    else if (typeof s.radius === "number") out.radius = s.radius;
    else if (typeof s.radius === "string" && !isNaN(Number(s.radius))) out.radius = Number(s.radius);
    if (typeof s.lat === "number") out.lat = s.lat;
    else if (typeof s.lat === "string" && !isNaN(Number(s.lat))) out.lat = Number(s.lat);
    if (typeof s.lng === "number") out.lng = s.lng;
    else if (typeof s.lng === "string" && !isNaN(Number(s.lng))) out.lng = Number(s.lng);
    return out;
  },
  loader: async ({ params }) => {
    const movie = await fetchMovieBySlug(params.slug);
    if (!movie) throw notFound();
    const [cinemas, showtimes] = await Promise.all([
      fetchCinemasForMovie(movie.id),
      fetchShowtimesForMovie(movie.id),
    ]);
    return { movie, cinemas, showtimes };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.movie.title} — Lanterna` },
          { name: "description", content: loaderData.movie.synopsis.slice(0, 155) },
        ]
      : [],
  }),
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
  const { movie, cinemas: cinemasShowing, showtimes } = Route.useLoaderData() as {
    movie: Movie;
    cinemas: Cinema[];
    showtimes: Showtime[];
  };
  const search = Route.useSearch();
  const { date, radius, lat, lng } = search;
  const hasGeo = radius && radius !== "all" && typeof lat === "number" && typeof lng === "number";

  const filteredCinemas = hasGeo
    ? cinemasShowing.filter((c) => {
        if (c.latitude == null || c.longitude == null) return false;
        return haversineKm({ lat: lat!, lng: lng! }, { lat: c.latitude, lng: c.longitude }) <= (radius as number);
      })
    : cinemasShowing;

  const filteredShowtimes = date ? showtimes.filter((s) => s.date === date) : showtimes;

  const byCinema = filteredCinemas
    .map((c) => ({
      cinema: c,
      days: filteredShowtimes.filter((s) => s.cinemaId === c.id),
    }))
    .filter((x) => x.days.length > 0);

  const hasFilters = Boolean(date) || hasGeo;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <section className="relative overflow-hidden border-b border-border/60">
        <div
          aria-hidden
          style={{
            "--p-a": movie.poster.a ?? "#8f332d",
            "--p-b": movie.poster.b ?? "#0b2545",
            "--p-c": movie.poster.c ?? "#111111",
            "--p-d": movie.poster.d ?? "#05070a",
          } as React.CSSProperties}
          className="poster-gradient absolute inset-0 scale-110 opacity-30 blur-3xl"
        />
        {movie.poster.url && (
          <img
            src={movie.poster.url}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover opacity-20 blur-2xl"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" />

        <div className="relative mx-auto grid max-w-[1400px] grid-cols-1 gap-12 px-8 py-16 lg:grid-cols-[340px_1fr]">
          <div>
            <Poster movie={movie} showTitle={false} className="shadow-2xl shadow-black/60" />
          </div>

          <div className="flex flex-col">
            <Link to="/" search={search} className="text-xs uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground">
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

      <section id="showtimes" className="mx-auto max-w-[1400px] px-8 py-16">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-2xl tracking-tight">Spilletider</h2>
            {date && (
              <span className="inline-flex items-center gap-2 rounded-full border border-primary bg-primary px-3 py-1 text-[10px] uppercase tracking-[0.15em] text-primary-foreground">
                {fmtDateLabel(date)}
              </span>
            )}
            {hasGeo && (
              <span className="inline-flex items-center gap-2 rounded-full border border-primary bg-primary px-3 py-1 text-[10px] uppercase tracking-[0.15em] text-primary-foreground">
                Inden for {radius} km
              </span>
            )}
            {hasFilters && (
              <Link
                to="/film/$slug"
                params={{ slug: movie.slug }}
                search={{}}
                className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Ryd filtre
              </Link>
            )}
          </div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {byCinema.length} biografer
          </div>
        </div>

        {byCinema.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-16 text-center">
            <p className="font-display text-xl text-foreground">Ingen spilletider matcher dine filtre</p>
            <Link
              to="/film/$slug"
              params={{ slug: movie.slug }}
              search={{}}
              className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
            >
              Ryd filtre
            </Link>
          </div>
        ) : (
          <div className="space-y-px overflow-hidden rounded-md bg-border">
            {byCinema.map(({ cinema, days }) => (
              <div key={cinema.id} className="bg-background p-6 lg:p-8">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{cinema.city}</div>
                    <Link
                      to="/biograf/$slug"
                      params={{ slug: cinema.slug }}
                      className="mt-1 inline-block font-display text-2xl tracking-tight text-foreground hover:text-primary"
                    >
                      {cinema.name}
                    </Link>
                    <div className="mt-1 text-xs text-muted-foreground">{cinema.address}</div>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  {days.map((d, i) => (
                    <div key={i}>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        {d.date} · {d.hall}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {d.times.map((t) =>
                          d.bookingUrl ? (
                            <a
                              key={t}
                              href={d.bookingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-sm border border-border bg-card/40 px-3 py-1.5 text-sm font-medium tabular-nums text-foreground transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
                            >
                              {t}
                            </a>
                          ) : (
                            <span
                              key={t}
                              className="rounded-sm border border-border bg-card/40 px-3 py-1.5 text-sm font-medium tabular-nums text-muted-foreground"
                            >
                              {t}
                            </span>
                          ),
                        )}
                      </div>
                      {d.bookingUrl && (
                        <a
                          href={d.bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium uppercase tracking-[0.15em] text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                          Køb billet
                          <span aria-hidden>→</span>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
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
