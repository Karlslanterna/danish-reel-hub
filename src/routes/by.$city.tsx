import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { MovieCard } from "@/components/MovieCard";
import { FilterBar, useFilters, haversineKm, fmtDateLabel } from "@/lib/filters";
import { fetchCinemas, fetchMoviesAndShowtimesForCinemas, type Cinema, type Movie, type Showtime } from "@/lib/cinema-data";

export const Route = createFileRoute("/by/$city")({
  loader: async ({ params }) => {
    const all = await fetchCinemas();
    const citySlug = params.city.toLowerCase();
    const stripPostcode = (s: string) => s.replace(/^\s*\d{3,4}\s+/u, "").trim();
    const stripBase = (s: string) =>
      stripPostcode(s).replace(/\s+[A-ZÆØÅ]{1,3}$/u, "").trim();
    const displayOf = (s: string) => stripPostcode(s).toLowerCase();
    const baseOf = (s: string) => stripBase(s).toLowerCase();
    const cinemas = all.filter(
      (c) =>
        displayOf(c.city) === citySlug ||
        baseOf(c.city) === citySlug ||
        c.city.toLowerCase().includes(citySlug),
    );
    if (cinemas.length === 0) throw notFound();
    const { movies, showtimes } = await fetchMoviesAndShowtimesForCinemas(cinemas.map((c) => c.id));
    movies.sort((a, b) => a.title.localeCompare(b.title, "da"));
    const displays = new Set(cinemas.map((c) => displayOf(c.city)));
    const displayCity = displays.size === 1 ? stripPostcode(cinemas[0].city) : stripBase(cinemas[0].city);
    return { city: displayCity, cinemas, movies, showtimes };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `Film i ${loaderData.city} — Lanterna` },
          { name: "description", content: `Find aktuelle film i ${loaderData.city}.` },
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
  const { city, cinemas, movies, showtimes } = Route.useLoaderData() as {
    city: string;
    cinemas: Cinema[];
    movies: Movie[];
    showtimes: Awaited<ReturnType<typeof fetchShowtimes>>;
  };
  const { radius, userLoc, selectedDate, geoLoading, geoError, clear } = useFilters();
  const hasFilters = Boolean(selectedDate) || radius !== "all";

  const cityCinemaIds = useMemo(() => new Set(cinemas.map((c) => c.id)), [cinemas]);

  const nearbyCinemaIds = useMemo(() => {
    if (radius === "all" || !userLoc) return null;
    const ids = new Set<string>();
    for (const c of cinemas) {
      if (c.latitude == null || c.longitude == null) continue;
      const d = haversineKm(userLoc, { lat: c.latitude, lng: c.longitude });
      if (d <= radius) ids.add(c.id);
    }
    return ids;
  }, [radius, userLoc, cinemas]);

  const filtered = useMemo(() => {
    const allowedCinemas = nearbyCinemaIds ?? cityCinemaIds;
    const movieIds = new Set<string>();
    for (const s of showtimes) {
      if (!allowedCinemas.has(s.cinemaId)) continue;
      if (selectedDate && s.date !== selectedDate) continue;
      movieIds.add(s.movieId);
    }
    return movies.filter((m) => movieIds.has(m.id));
  }, [movies, showtimes, selectedDate, nearbyCinemaIds, cityCinemaIds]);

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
            {cinemas.length} {cinemas.length === 1 ? "biograf" : "biografer"} · {movies.length} film
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-8 py-14">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <h2 className="font-display text-2xl tracking-tight">Film i {city}</h2>
            <FilterBar />
            {hasFilters && (
              <button
                type="button"
                onClick={clear}
                className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Ryd filtre
              </button>
            )}
          </div>
          <div className="text-right text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {geoLoading && <div>Finder din placering…</div>}
            {geoError && <div className="text-destructive">{geoError}</div>}
            <div>
              {filtered.length} film{selectedDate ? ` · ${fmtDateLabel(selectedDate)}` : ""}
              {radius !== "all" && userLoc ? ` · inden for ${radius} km` : ""}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-24 text-center">
            <p className="font-display text-xl text-foreground">Ingen film matcher</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Prøv en anden dato eller en større radius.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((m) => (
              <MovieCard key={m.id} movie={m} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
