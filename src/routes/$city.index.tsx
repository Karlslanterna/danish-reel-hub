import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Breadcrumb } from "@/components/Breadcrumb";
import { MovieCard } from "@/components/MovieCard";
import { FilterBar, GeoNotice, useFilters, haversineKm, fmtDateLabel } from "@/lib/filters";
import { collectTagOptions, showtimeMatchesTags, hasTagSelection } from "@/lib/showtime-tags";
import { fetchCinemas, fetchMoviesAndShowtimesForCinemas, type Cinema, type Movie, type Showtime } from "@/lib/cinema-data";
import { baseCityOf, cityMatchesSlug, cityOptionsFrom, citySlug, displayCityOf, type CityOption } from "@/lib/city-slug";
import { canonicalUrl } from "@/lib/canonical";
import { citySchemas } from "@/lib/jsonld";

export const Route = createFileRoute("/$city/")({
  loader: async ({ params }) => {
    const slug = params.city.toLowerCase();
    const all = await fetchCinemas();
    const cinemas = all.filter((c) => cityMatchesSlug(c.city, slug));
    if (cinemas.length === 0) throw notFound();
    const { movies, showtimes } = await fetchMoviesAndShowtimesForCinemas(cinemas.map((c) => c.id));
    movies.sort((a, b) => a.title.localeCompare(b.title, "da"));
    const cityName = baseCityOf(cinemas[0].city);
    const canonicalSlug = citySlug(cinemas[0].city);
    const otherCities = cityOptionsFrom(all).filter((c) => c.slug !== canonicalSlug);
    return { cityName, canonicalSlug, cinemas, movies, showtimes, otherCities };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Byen findes ikke — Lanterna" }, { name: "robots", content: "noindex" }] };
    const href = canonicalUrl(`/${loaderData.canonicalSlug}`);
    const title = `Film og spilletider i ${loaderData.cityName} | LANTERNA`;
    const description = `Se alle aktuelle film og spilletider i ${loaderData.cityName}. ${loaderData.cinemas.length} biografer og ${loaderData.movies.length} film på plakaten.`;
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
      scripts: citySchemas(loaderData.canonicalSlug, loaderData.cityName),
    };
  },
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
  const { cityName, canonicalSlug, cinemas, movies, showtimes, otherCities } = Route.useLoaderData() as {
    cityName: string;
    canonicalSlug: string;
    cinemas: Cinema[];
    movies: Movie[];
    showtimes: Showtime[];
    otherCities: CityOption[];
  };
  const {
    radius, userLoc, selectedDate, selectedGenre, selectedFormat, selectedLanguage, selectedEvent,
    selectedCity, setSelectedCity, selectedCinemaId, geoLoading, clear,
  } = useFilters();
  useCinemaUrlSync(useMemo(() => cinemas.map((c) => ({ id: c.id, slug: c.slug, name: c.name, city: c.city })), [cinemas]));

  // Keep the global filter state in sync with the city in the URL.
  useEffect(() => {
    if (selectedCity !== cityName) setSelectedCity(cityName);
  }, [cityName, selectedCity, setSelectedCity]);

  const tagSel = { format: selectedFormat, language: selectedLanguage, event: selectedEvent };
  const hasFilters = Boolean(selectedDate) || radius !== "all" || Boolean(selectedGenre) || hasTagSelection(tagSel);

  const allGenres = useMemo(() => movies.flatMap((m) => m.genre), [movies]);
  const tagOptions = useMemo(() => collectTagOptions(showtimes), [showtimes]);
  const cityCinemaIds = useMemo(() => new Set(cinemas.map((c) => c.id)), [cinemas]);

  const nearbyCinemaIds = useMemo(() => {
    if (radius === "all" || !userLoc) return null;
    const ids = new Set<string>();
    for (const c of cinemas) {
      if (c.latitude == null || c.longitude == null) continue;
      if (haversineKm(userLoc, { lat: c.latitude, lng: c.longitude }) <= radius) ids.add(c.id);
    }
    return ids;
  }, [radius, userLoc, cinemas]);

  const filtered = useMemo(() => {
    const allowed = nearbyCinemaIds ?? cityCinemaIds;
    const movieIds = new Set<string>();
    for (const s of showtimes) {
      if (!allowed.has(s.cinemaId)) continue;
      if (selectedDate && s.date !== selectedDate) continue;
      if (!showtimeMatchesTags(s, tagSel)) continue;
      movieIds.add(s.movieId);
    }
    return movies.filter((m) => movieIds.has(m.id) && (!selectedGenre || m.genre.includes(selectedGenre)));
  }, [movies, showtimes, selectedDate, selectedGenre, selectedFormat, selectedLanguage, selectedEvent, nearbyCinemaIds, cityCinemaIds]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-6 py-10 sm:px-8 sm:py-16">
          <Link to="/" className="text-xs uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground">
            ← Forside
          </Link>
          <div className="mt-4">
            <Breadcrumb items={[{ label: "Forside", to: "/" }, { label: cityName }]} />
          </div>
          <div className="mt-6 text-xs uppercase tracking-[0.25em] text-primary">By</div>
          <h1 className="mt-3 font-display text-5xl font-bold leading-[0.9] tracking-tight text-foreground sm:text-7xl">
            Film i {cityName}
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            {cinemas.length} {cinemas.length === 1 ? "biograf" : "biografer"} · {movies.length} film
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-6 py-10 sm:px-8 sm:py-14">
        <GeoNotice className="mb-6" />
        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <h2 className="font-display text-2xl tracking-tight">Aktuelle film</h2>
            <FilterBar genres={allGenres} formats={tagOptions.formats} languages={tagOptions.languages} events={tagOptions.events} cities={[{ value: cityName, count: cinemas.length }, ...otherCities.map((c) => ({ value: c.name, count: c.count }))]} />
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
            <div>
              {filtered.length} film{selectedDate ? ` · ${fmtDateLabel(selectedDate)}` : ""}
              {radius !== "all" && userLoc ? ` · inden for ${radius} km` : ""}
              {selectedGenre ? ` · ${selectedGenre}` : ""}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-24 text-center">
            <p className="font-display text-xl text-foreground">Ingen film matcher</p>
            <p className="mt-2 text-sm text-muted-foreground">Prøv en anden dato eller en større radius.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((m) => (
              <MovieCard key={m.id} movie={m} citySlug={canonicalSlug} />
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-border/60">
        <div className="mx-auto max-w-[1400px] px-6 py-12 sm:px-8">
          <h2 className="font-display text-2xl tracking-tight">Biografer i {cityName}</h2>
          <div className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-md bg-border sm:grid-cols-2 lg:grid-cols-3">
            {cinemas.map((c) => (
              <Link
                key={c.id}
                to="/biograf/$slug"
                params={{ slug: c.slug }}
                className="bg-background p-5 transition-colors hover:bg-secondary/50"
              >
                <div className="font-display text-lg text-foreground">{c.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{c.address}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{displayCityOf(c.city)}</div>
              </Link>
            ))}
          </div>

          {otherCities.length > 0 && (
            <div className="mt-12">
              <h2 className="font-display text-2xl tracking-tight">Andre byer</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {otherCities.map((c) => (
                  <Link
                    key={c.slug}
                    to="/$city"
                    params={{ city: c.slug }}
                    className="rounded-full border border-border bg-card/40 px-4 py-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
                  >
                    {c.name} ({c.count})
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
