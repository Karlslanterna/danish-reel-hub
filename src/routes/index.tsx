import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, useEffect } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { MovieCard } from "@/components/MovieCard";
import {
  FilterBar,
  GeoNotice,
  useFilters,
  useCinemaUrlSync,
  haversineKm,
  fmtDateLabel,
} from "@/lib/filters";
import { showtimeMatchesTags, hasTagSelection } from "@/lib/showtime-tags";
import { rankMoviesByScreenings } from "@/lib/movie-sort";
import {
  fetchMovies,
  fetchCinemas,
  fetchShowtimeIndex,
  type Movie,
  type Cinema,
} from "@/lib/cinema-data";
import { canonicalUrl } from "@/lib/canonical";
import { citySlug, slugifyCity } from "@/lib/city-slug";
import { homeSchemas } from "@/lib/jsonld";
import { useLanguage } from "@/lib/i18n";
import { isMovieForChildren } from "@/lib/children-filter";
import { showtimeMatchesTimePeriod } from "@/lib/time-filter";
import {
  compactShowtimeIndex,
  expandShowtimeIndex,
  remapShowtimeIndexToMovies,
  type CompactShowtimeIndex,
} from "@/lib/public-catalog";
import {
  isSpecialEventTag,
  specialEventDefinition,
  type SpecialEventTag,
} from "@/lib/special-events";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { buildFilterFacets } from "@/lib/filter-facets";

export type HomeCatalogData = {
  movies: Movie[];
  cinemas: Cinema[];
  showtimeIndex: CompactShowtimeIndex;
};

export const HOME_CATALOG_QUERY_KEY = ["public-home-catalog"] as const;

export async function loadHomeCatalog(): Promise<HomeCatalogData> {
  const [movies, cinemas, rawShowtimeIndex] = await Promise.all([
    fetchMovies(),
    fetchCinemas(),
    fetchShowtimeIndex(),
  ]);
  const showtimeIndex = remapShowtimeIndexToMovies(rawShowtimeIndex, movies);
  return { movies, cinemas, showtimeIndex: compactShowtimeIndex(showtimeIndex) };
}

export function loadCachedHomeCatalog(queryClient: QueryClient): Promise<HomeCatalogData> {
  return queryClient.ensureQueryData({
    queryKey: HOME_CATALOG_QUERY_KEY,
    queryFn: loadHomeCatalog,
    staleTime: 5 * 60 * 1000,
    revalidateIfStale: true,
  });
}

export const Route = createFileRoute("/")({
  loader: ({ context }) => loadCachedHomeCatalog(context.queryClient),
  head: () => {
    const title = "Lanterna — Find film og spilletider i Danmark";
    const description =
      "Opdag film, se spilletider og find din nærmeste biograf i København, Aarhus, Odense og Aalborg.";
    const image = "https://lanterna.dk/og-image.jpg";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonicalUrl("/") },
        { property: "og:image", content: image },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: image },
      ],
      links: [{ rel: "canonical", href: canonicalUrl("/") }],
      scripts: homeSchemas(),
    };
  },
  errorComponent: ({ reset }) => (
    <div className="p-12">
      <button onClick={reset} className="text-primary">
        Prøv igen
      </button>
    </div>
  ),
  notFoundComponent: () => <div className="p-12">Siden findes ikke</div>,
  component: IndexPage,
});

type Suggestion =
  | { kind: "movie"; label: string; sub: string; slug: string }
  | { kind: "cinema"; label: string; sub: string; slug: string }
  | { kind: "city"; label: string; sub: string; city: string };

const displayCityOf = (s: string) => s.replace(/^\s*\d{3,4}\s+/u, "").trim();
const baseCityOf = (s: string) =>
  displayCityOf(s)
    .replace(/\s+[A-ZÆØÅ]{1,3}$/u, "")
    .trim();

function IndexPage() {
  return <HomePage catalog={Route.useLoaderData()} />;
}

export function HomePage({
  catalog,
  childrenOnly = false,
  specialEvent,
}: {
  catalog: HomeCatalogData;
  childrenOnly?: boolean;
  specialEvent?: SpecialEventTag;
}) {
  const queryClient = useQueryClient();
  const { movies, cinemas, showtimeIndex: compactIndex } = catalog;

  // Both `/` and `/for-boern` render from the same public catalog. Seeding the
  // shared query cache avoids downloading and rebuilding it on every toggle.
  useEffect(() => {
    queryClient.setQueryData(HOME_CATALOG_QUERY_KEY, catalog);
  }, [catalog, queryClient]);
  const showtimeIndex = useMemo(() => expandShowtimeIndex(compactIndex), [compactIndex]);
  const {
    radius,
    userLoc,
    selectedDate,
    selectedTime,
    selectedGenre,
    selectedFormat,
    selectedLanguage,
    selectedEvent,
    childrenOnly: selectedChildrenOnly,
    selectedCity,
    selectedCinemaId,
    geoLoading,
    setSelectedEvent,
    setChildrenOnly,
  } = useFilters();
  const activeChildrenOnly = childrenOnly || selectedChildrenOnly;
  const activeSpecialEvent =
    specialEvent ?? (selectedEvent && isSpecialEventTag(selectedEvent) ? selectedEvent : undefined);

  useEffect(() => {
    if (childrenOnly) setChildrenOnly(true);
  }, [childrenOnly, setChildrenOnly]);

  useEffect(() => {
    if (specialEvent) setSelectedEvent(specialEvent);
  }, [specialEvent, setSelectedEvent]);

  const screeningsByMovie = useMemo(() => {
    const map = new Map<string, typeof showtimeIndex>();
    for (const screening of showtimeIndex) {
      const rows = map.get(screening.movieId) ?? [];
      rows.push(screening);
      map.set(screening.movieId, rows);
    }
    return map;
  }, [showtimeIndex]);
  const catalogMovies = useMemo(
    () =>
      movies.filter((movie) => {
        const screenings = screeningsByMovie.get(movie.id) ?? [];
        if (activeChildrenOnly && !isMovieForChildren(movie, screenings)) return false;
        return true;
      }),
    [activeChildrenOnly, movies, screeningsByMovie],
  );
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useCinemaUrlSync(
    useMemo(
      () => cinemas.map((c) => ({ id: c.id, slug: c.slug, name: c.name, city: c.city })),
      [cinemas],
    ),
  );
  const tagSel = useMemo(
    () => ({
      format: selectedFormat,
      language: selectedLanguage,
      event: activeSpecialEvent,
    }),
    [selectedFormat, selectedLanguage, activeSpecialEvent],
  );
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const eventPage = activeSpecialEvent ? specialEventDefinition(activeSpecialEvent) : null;
  // The explicit landing route owns its hero copy. Persisted filters may
  // narrow that landing page, but must not relabel `/for-boern` as Babybio (or
  // relabel an explicit special-event route as the generic children page).
  const showChildrenHero = childrenOnly || (!eventPage && activeChildrenOnly);
  const heroEventPage = childrenOnly ? null : eventPage;

  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

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

  // "Near me" overrides the city filter while it is active.
  const cityCinemaIds = useMemo(() => {
    if (nearbyCinemaIds || !selectedCity) return null;
    const ids = new Set<string>();
    for (const c of cinemas) {
      if (baseCityOf(c.city) === selectedCity) ids.add(c.id);
    }
    return ids;
  }, [selectedCity, cinemas, nearbyCinemaIds]);

  // A specific cinema is the narrowest selection and wins over city / radius.
  const activeCinemaIds = useMemo(
    () => (selectedCinemaId ? new Set([selectedCinemaId]) : (nearbyCinemaIds ?? cityCinemaIds)),
    [selectedCinemaId, nearbyCinemaIds, cityCinemaIds],
  );

  const selectedCinemaIds = useMemo(
    () => (selectedCinemaId ? new Set([selectedCinemaId]) : null),
    [selectedCinemaId],
  );
  const baseMovieIds = useMemo(
    () => (activeChildrenOnly ? new Set(catalogMovies.map((movie) => movie.id)) : null),
    [activeChildrenOnly, catalogMovies],
  );
  const facets = useMemo(
    () =>
      buildFilterFacets(showtimeIndex, movies, {
        baseCinemaIds: nearbyCinemaIds ?? cityCinemaIds,
        cinemaIds: selectedCinemaIds,
        baseMovieIds,
        date: selectedDate,
        time: selectedTime,
        genre: selectedGenre,
        format: selectedFormat,
        language: selectedLanguage,
        event: activeSpecialEvent,
      }),
    [
      showtimeIndex,
      movies,
      nearbyCinemaIds,
      cityCinemaIds,
      selectedCinemaIds,
      baseMovieIds,
      selectedDate,
      selectedTime,
      selectedGenre,
      selectedFormat,
      selectedLanguage,
      activeSpecialEvent,
    ],
  );
  const allGenres = facets.genres;
  const tagOptions = facets;

  const cities = useMemo(() => {
    const map = new Map<string, { count: number; raws: string[] }>();
    for (const c of cinemas) {
      const key = displayCityOf(c.city);
      const e = map.get(key) ?? { count: 0, raws: [] };
      e.count += 1;
      e.raws.push(c.city);
      map.set(key, e);
    }
    return Array.from(map, ([city, v]) => ({ city, count: v.count, raws: v.raws }));
  }, [cinemas]);

  const baseCities = useMemo(() => {
    const map = new Map<string, { cinemas: number; variants: Set<string>; raws: string[] }>();
    for (const c of cinemas) {
      const base = baseCityOf(c.city);
      const entry = map.get(base) ?? { cinemas: 0, variants: new Set<string>(), raws: [] };
      entry.cinemas += 1;
      entry.variants.add(displayCityOf(c.city));
      entry.raws.push(c.city);
      map.set(base, entry);
    }
    return Array.from(map, ([city, v]) => ({
      city,
      cinemas: v.cinemas,
      variants: v.variants.size,
      raws: v.raws,
    }));
  }, [cinemas]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Suggestion[] = [];
    const seenCities = new Set<string>();

    // Combined base-city suggestions first (when the base spans multiple areas/postcodes)
    for (const b of baseCities) {
      const matches =
        b.city.toLowerCase().includes(q) || b.raws.some((r) => r.toLowerCase().includes(q));
      if (b.variants > 1 && matches) {
        out.push({
          kind: "city",
          label: b.city,
          sub: `${b.cinemas} ${b.cinemas === 1 ? t("sug.cinema") : t("sug.cinemas")} · ${b.variants} ${t("sug.areas")}`,
          city: b.city,
        });
        seenCities.add(b.city.toLowerCase());
      }
    }
    for (const c of cities) {
      if (seenCities.has(c.city.toLowerCase())) continue;
      const matches =
        c.city.toLowerCase().includes(q) || c.raws.some((r) => r.toLowerCase().includes(q));
      if (matches) {
        out.push({
          kind: "city",
          label: c.city,
          sub: `${c.count} ${c.count === 1 ? t("sug.cinema") : t("sug.cinemas")}`,
          city: c.city,
        });
        seenCities.add(c.city.toLowerCase());
      }
    }
    for (const m of catalogMovies) {
      if (m.title.toLowerCase().includes(q) || m.director.toLowerCase().includes(q)) {
        out.push({ kind: "movie", label: m.title, sub: m.director, slug: m.slug });
      }
    }
    for (const c of cinemas) {
      if (c.name.toLowerCase().includes(q)) {
        out.push({ kind: "cinema", label: c.name, sub: displayCityOf(c.city), slug: c.slug });
      }
    }
    return out.slice(0, 8);
  }, [query, catalogMovies, cinemas, cities, baseCities, t]);

  // Screenings that survive the active cinema/date/tag filters — they drive the ranking.
  const matchingScreenings = useMemo(() => {
    const tagged = hasTagSelection(tagSel);
    return showtimeIndex.filter((s) => {
      if (activeCinemaIds && !activeCinemaIds.has(s.cinemaId)) return false;
      if (selectedDate && s.date !== selectedDate) return false;
      if (selectedTime && !showtimeMatchesTimePeriod(s.times, selectedTime)) return false;
      if (tagged && !showtimeMatchesTags(s, tagSel)) return false;
      return true;
    });
  }, [showtimeIndex, activeCinemaIds, selectedDate, selectedTime, tagSel]);

  // Every active screening constraint must match the same screening. Intersecting
  // separate movie-id sets would otherwise show a film whose requested format or
  // date only exists at a different cinema.
  const matchingMovieIds = useMemo(() => {
    if (!activeCinemaIds && !selectedDate && !selectedTime && !hasTagSelection(tagSel)) return null;
    return new Set(matchingScreenings.map((screening) => screening.movieId));
  }, [activeCinemaIds, selectedDate, selectedTime, tagSel, matchingScreenings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = catalogMovies.filter((m) => {
      if (matchingMovieIds && !matchingMovieIds.has(m.id)) return false;
      if (selectedGenre && !m.genre.includes(selectedGenre)) return false;
      return (
        !q ||
        m.title.toLowerCase().includes(q) ||
        m.director.toLowerCase().includes(q) ||
        m.genre.some((g) => g.toLowerCase().includes(q))
      );
    });
    // Unfiltered view keeps the database ranking from `movies_ranked`.
    const noScreeningFilter = matchingMovieIds === null;
    return noScreeningFilter ? visible : rankMoviesByScreenings(visible, matchingScreenings);
  }, [query, catalogMovies, matchingMovieIds, selectedGenre, matchingScreenings]);

  const lastZeroResult = useRef("");
  useEffect(() => {
    const hasConstraint = Boolean(
      query.trim() ||
      activeChildrenOnly ||
      activeSpecialEvent ||
      activeCinemaIds ||
      selectedDate ||
      selectedTime ||
      selectedGenre ||
      hasTagSelection(tagSel),
    );
    if (!hasConstraint || filtered.length > 0) {
      lastZeroResult.current = "";
      return;
    }
    const signature = JSON.stringify([
      query.trim().toLowerCase(),
      activeChildrenOnly,
      activeSpecialEvent,
      selectedDate,
      selectedTime,
      selectedGenre,
      tagSel,
      selectedCity,
      selectedCinemaId,
      radius,
    ]);
    if (lastZeroResult.current === signature) return;
    lastZeroResult.current = signature;
    trackAnalyticsEvent({ eventType: "zero_results" });
  }, [
    filtered.length,
    query,
    activeChildrenOnly,
    activeSpecialEvent,
    activeCinemaIds,
    selectedDate,
    selectedTime,
    selectedGenre,
    tagSel,
    selectedCity,
    selectedCinemaId,
    radius,
  ]);

  const nearbyCinemaCount = nearbyCinemaIds?.size ?? null;

  const cityOptions = useMemo(
    () => baseCities.map((b) => ({ value: b.city, count: b.cinemas })),
    [baseCities],
  );

  // "Near me" constrains which cinemas can be picked; the city constraint is
  // applied inside FilterBar.
  const cinemaOptions = useMemo(
    () =>
      cinemas
        .filter((c) => facets.cinemaIds.has(c.id))
        .map((c) => ({ id: c.id, slug: c.slug, name: c.name, city: c.city })),
    [cinemas, facets.cinemaIds],
  );

  const childrenCitySlugs = useMemo(() => {
    if (!activeChildrenOnly) return [];
    const childIds = new Set(catalogMovies.map((movie) => movie.id));
    const cityByCinema = new Map(cinemas.map((cinema) => [cinema.id, citySlug(cinema.city)]));
    const moviesByCity = new Map<string, Set<string>>();
    for (const screening of showtimeIndex) {
      if (!childIds.has(screening.movieId)) continue;
      const city = cityByCinema.get(screening.cinemaId);
      if (!city) continue;
      const ids = moviesByCity.get(city) ?? new Set<string>();
      ids.add(screening.movieId);
      moviesByCity.set(city, ids);
    }
    return [...moviesByCity].filter(([, ids]) => ids.size >= 2).map(([city]) => city);
  }, [activeChildrenOnly, catalogMovies, cinemas, showtimeIndex]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (s: Suggestion) => {
    setOpen(false);
    if (s.kind === "movie") navigate({ to: "/film/$slug", params: { slug: s.slug } });
    else if (s.kind === "cinema") navigate({ to: "/biograf/$slug", params: { slug: s.slug } });
    else navigate({ to: "/$city", params: { city: slugifyCity(s.city) } });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader onSearchClick={() => setOpen(true)} />

      {open && (
        <div
          className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm"

          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <div className="flex min-h-full items-start justify-center px-4 pt-6 sm:pt-24">
            <div
              ref={boxRef}
              className="w-full max-w-2xl rounded-lg border border-border/80 bg-card p-4 shadow-2xl shadow-black/40 sm:p-5"
            >
              <div className="relative">
                <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-primary-foreground/70">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </div>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={t("home.search")}
                  className="h-14 w-full rounded-md border border-primary/80 bg-primary pl-12 pr-24 font-display text-lg text-primary-foreground placeholder:font-sans placeholder:text-base placeholder:text-primary-foreground/60 focus:border-primary-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary-foreground/30"
                  aria-autocomplete="list"
                  aria-expanded={suggestions.length > 0}
                />
                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                  {query && (
                    <button
                      onClick={() => setQuery("")}
                      className="rounded-sm px-2 py-1 text-xs uppercase tracking-wider text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
                    >
                      {t("home.clearSearch")}
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    aria-label="Luk"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>
              </div>

              {suggestions.length > 0 && (
                <ul
                  role="listbox"
                  className="mt-3 max-h-[60vh] overflow-y-auto rounded-md border border-border/80 bg-card"
                >
                  {suggestions.map((s, i) => (
                    <li
                      key={`${s.kind}-${s.label}-${i}`}
                      role="option"
                      aria-selected={i === active}
                    >
                      <button
                        type="button"
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(s)}
                        className={`flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors ${
                          i === active ? "bg-secondary" : "hover:bg-secondary/60"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-display text-base text-foreground">
                            {s.label}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{s.sub}</div>
                        </div>
                        <span className="shrink-0 text-[10px] uppercase tracking-[0.2em] text-primary">
                          {s.kind === "movie"
                            ? t("kind.movie")
                            : s.kind === "cinema"
                              ? t("kind.cinema")
                              : t("kind.city")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-6 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-10">
          <div className="flex items-end justify-between gap-6">
            <div className="max-w-2xl">
              <h1 className="font-hero text-3xl leading-[0.95] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
                {heroEventPage?.hero ??
                  (showChildrenHero ? t("home.childrenHero") : t("home.hero"))}
              </h1>
              <p className="font-hero mt-2 max-w-md text-sm leading-relaxed text-muted-foreground sm:mt-4">
                {heroEventPage?.sub ?? (showChildrenHero ? t("home.childrenSub") : t("home.sub"))}
              </p>
            </div>
            <div className="hidden text-right text-xs uppercase tracking-[0.2em] text-muted-foreground lg:block">
              <div>
                {catalogMovies.length} {t("home.movies")}
              </div>
              <div className="mt-1">
                {cinemas.length} {t("home.cinemas")}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-4 py-5 sm:px-8 sm:py-10">
        <GeoNotice className="mb-4" />
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4 sm:mb-6 sm:gap-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <FilterBar
              showChildrenFilter
              childrenOnly={childrenOnly}
              childrenRouteEnabled
              fixedEvent={specialEvent}
              eventRouteEnabled
              showTimeFilter
              availableDates={facets.dates}
              availableTimes={facets.times}
              genres={allGenres}
              formats={tagOptions.formats}
              languages={tagOptions.languages}
              events={tagOptions.events}
              cities={cityOptions}
              cinemas={cinemaOptions}
            />
          </div>
          <div className="text-right text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {geoLoading && <div>{t("home.locating")}</div>}
            {radius !== "all" && userLoc && nearbyCinemaCount !== null && (
              <div>
                {nearbyCinemaCount} {t("home.cinemas")} · {filtered.length} {t("home.movies")}{" "}
                {t("home.within")} {radius} km
                {selectedDate ? ` · ${fmtDateLabel(selectedDate, lang)}` : ""}
                {selectedGenre ? ` · ${selectedGenre}` : ""}
              </div>
            )}
            {(radius === "all" || (!userLoc && !geoLoading)) && (
              <div>
                {filtered.length} {t("home.movies")}
                {selectedDate ? ` · ${fmtDateLabel(selectedDate, lang)}` : ""}
                {selectedGenre ? ` · ${selectedGenre}` : ""}
              </div>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-24 text-center">
            <p className="font-display text-xl text-foreground">{t("home.noMatch")}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {radius !== "all" && userLoc ? t("home.tryRadius") : t("home.tryQuery")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((m) => (
              <MovieCard
                key={m.id}
                movie={m}
                citySlug={selectedCity && !nearbyCinemaIds ? slugifyCity(selectedCity) : null}
              />
            ))}
          </div>
        )}
      </section>

      <section id="cinemas" className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-[1400px] px-8 py-16">
          <div className="mb-8 flex items-baseline justify-between">
            <h2 className="font-display text-2xl tracking-tight">{t("home.cinemasHeading")}</h2>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {nearbyCinemaIds
                ? `${nearbyCinemaIds.size} ${t("home.within")} ${radius} km`
                : `${activeCinemaIds ? activeCinemaIds.size : cinemas.length} ${t("home.places")}`}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md bg-border md:grid-cols-2 lg:grid-cols-3">
            {cinemas
              .filter((c) => !activeCinemaIds || activeCinemaIds.has(c.id))
              .map((c) => (
                <Link
                  key={c.id}
                  to="/biograf/$slug"
                  params={{ slug: c.slug }}
                  className="group flex items-center justify-between bg-background p-6 transition-colors hover:bg-card"
                >
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {displayCityOf(c.city)}
                    </div>
                    <h3 className="mt-2 font-display text-2xl tracking-tight text-foreground group-hover:text-primary">
                      {c.name}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {c.description}
                    </p>
                  </div>
                  <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
                    {c.screens > 0 ? (
                      <span>
                        {c.screens} {t("home.screens")}
                      </span>
                    ) : (
                      <span />
                    )}
                    <span className="text-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary">
                      →
                    </span>
                  </div>
                </Link>
              ))}
          </div>
        </div>
      </section>

      <SiteFooter
        cinemas={cinemas}
        specialEvents={tagOptions.events}
        childrenCitySlugs={childrenCitySlugs}
      />
    </div>
  );
}
