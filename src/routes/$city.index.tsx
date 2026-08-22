import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Breadcrumb } from "@/components/Breadcrumb";
import { MovieCard } from "@/components/MovieCard";
import {
  FilterBar,
  GeoNotice,
  useFilters,
  useCinemaUrlSync,
  haversineKm,
  fmtDateLabel,
} from "@/lib/filters";
import { showtimeMatchesTags } from "@/lib/showtime-tags";
import { displayCityOf } from "@/lib/city-slug";
import { canonicalUrl } from "@/lib/canonical";
import { citySchemas } from "@/lib/jsonld";
import { SiteFooter } from "@/components/SiteFooter";
import { cityTitle, cityDescription } from "@/lib/seo";
import { rankMoviesByScreenings } from "@/lib/movie-sort";
import { showtimeMatchesTimePeriod } from "@/lib/time-filter";
import { isMovieForChildren } from "@/lib/children-filter";
import { buildFilterFacets } from "@/lib/filter-facets";
import { useTrackZeroResults } from "@/lib/analytics";
import { expandShowtimeIndex, type CompactShowtimeIndex } from "@/lib/public-catalog";
import {
  cityCatalogQueryKey,
  loadCityCatalogData,
  loadCityShellData,
  type CityCatalogData,
} from "@/lib/city-catalog";

const INITIAL_MOVIE_CARD_COUNT = 40;
const MOVIE_CARD_BATCH_SIZE = 40;
const FULL_CATALOG_FALLBACK_MS = 8_000;
const LCP_PRIORITY_POSTERS = 2;
const MOVIE_CARD_SIZES =
  "(min-width: 1280px) 18vw, (min-width: 1024px) 23vw, (min-width: 640px) 31vw, 46vw";

export async function loadCityCatalog(cityParam: string): Promise<CityCatalogData> {
  const catalog = await loadCityCatalogData(cityParam);
  if (!catalog) throw notFound();
  return catalog;
}

async function loadCityShell(cityParam: string): Promise<CityCatalogData> {
  const catalog = await loadCityShellData(cityParam);
  if (!catalog) throw notFound();
  return catalog;
}

export type { CityCatalogData };

export const Route = createFileRoute("/$city/")({
  // The city route used to await and serialize the complete 30-day programme.
  // First paint now gets a bounded card shell; filters hydrate the full index later.
  loader: ({ params }) => loadCityShell(params.city),
  head: ({ loaderData }) => {
    if (!loaderData)
      return {
        meta: [{ title: "Byen findes ikke — Lanterna" }, { name: "robots", content: "noindex" }],
      };
    const href = canonicalUrl(`/${loaderData.canonicalSlug}`);
    const title = cityTitle(loaderData.cityName);
    const description = loaderData.totalMoviesExact
      ? cityDescription(loaderData.cityName, loaderData.cinemas.length, loaderData.totalMovies)
      : `Biografprogram for ${loaderData.cityName}: aktuelle film i ${loaderData.cinemas.length} biografer. Se spilletider i dag og de kommende dage og køb billetter.`;
    const hasScreenings = loaderData.hasScreenings;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...(hasScreenings ? [] : [{ name: "robots", content: "noindex, follow" }]),
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: href },
        { property: "og:type", content: "website" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href: hasScreenings ? href : canonicalUrl("/biograf") }],
      scripts: citySchemas(loaderData.canonicalSlug, loaderData.cityName),
    };
  },
  notFoundComponent: () => (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-8 py-24 text-center">
        <h1 className="font-display text-4xl">Ingen biografer i denne by</h1>
        <Link
          to="/"
          className="mt-6 inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          Tilbage
        </Link>
      </div>
    </div>
  ),
  errorComponent: ({ reset }) => (
    <div className="p-12">
      <button onClick={reset} className="text-primary">
        Prøv igen
      </button>
    </div>
  ),
  component: CityRoutePage,
});

function CityRoutePage() {
  return <CityPage data={Route.useLoaderData()} />;
}

export function CityPage({
  data,
  fixedChildrenOnly = false,
}: {
  data: CityCatalogData;
  fixedChildrenOnly?: boolean;
}) {
  const [loadFull, setLoadFull] = useState(data.complete);
  const requestFullCatalog = useCallback(() => setLoadFull(true), []);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoadFull(data.complete);
  }, [data.canonicalSlug, data.complete]);

  useEffect(() => {
    if (data.complete) return;
    const id = setTimeout(requestFullCatalog, FULL_CATALOG_FALLBACK_MS);
    return () => clearTimeout(id);
  }, [data.complete, data.canonicalSlug, requestFullCatalog]);

  const fullCatalogQuery = useQuery({
    queryKey: cityCatalogQueryKey(data.canonicalSlug),
    queryFn: async () => {
      const catalog = await loadCityCatalogData(data.canonicalSlug);
      if (!catalog) throw new Error(`City catalogue disappeared: ${data.canonicalSlug}`);
      return catalog;
    },
    enabled: loadFull,
    staleTime: 5 * 60 * 1000,
    ...(data.complete ? { initialData: data } : {}),
  });
  const activeCatalog = fullCatalogQuery.data?.complete ? fullCatalogQuery.data : data;
  const catalogReady = activeCatalog.complete;
  const { cityName, canonicalSlug, cinemas, movies, showtimes: compact, otherCities } =
    activeCatalog;
  const showtimes = useMemo(() => expandShowtimeIndex(compact as CompactShowtimeIndex), [compact]);
  const [visibleMovieCount, setVisibleMovieCount] = useState(INITIAL_MOVIE_CARD_COUNT);
  const {
    hydrated: filtersHydrated,
    radius,
    userLoc,
    selectedDate,
    selectedTime,
    selectedGenre,
    selectedFormat,
    selectedLanguage,
    selectedEvent,
    childrenOnly,
    setChildrenOnly,
    selectedCity,
    setSelectedCity,
    selectedCinemaId,
    geoLoading,
  } = useFilters();
  useCinemaUrlSync(
    useMemo(
      () => cinemas.map((c) => ({ id: c.id, slug: c.slug, name: c.name, city: c.city })),
      [cinemas],
    ),
  );

  // Keep the global filter state in sync with the city in the URL.
  useEffect(() => {
    if (filtersHydrated && selectedCity !== cityName) setSelectedCity(cityName);
  }, [filtersHydrated, cityName, selectedCity, setSelectedCity]);

  useEffect(() => {
    if (filtersHydrated && fixedChildrenOnly) setChildrenOnly(true);
  }, [filtersHydrated, fixedChildrenOnly, setChildrenOnly]);

  const activeChildrenOnly = fixedChildrenOnly || childrenOnly;

  // A persisted screening constraint means the visitor already expressed
  // filter intent before this navigation, so hydrate the complete programme now.
  useEffect(() => {
    if (!filtersHydrated || catalogReady) return;
    if (
      selectedDate ||
      selectedTime ||
      selectedGenre ||
      selectedFormat ||
      selectedLanguage ||
      selectedEvent ||
      activeChildrenOnly ||
      selectedCinemaId ||
      (radius !== "all" && userLoc)
    ) {
      requestFullCatalog();
    }
  }, [
    filtersHydrated,
    catalogReady,
    selectedDate,
    selectedTime,
    selectedGenre,
    selectedFormat,
    selectedLanguage,
    selectedEvent,
    activeChildrenOnly,
    selectedCinemaId,
    radius,
    userLoc,
    requestFullCatalog,
  ]);

  const tagSel = useMemo(
    () => ({ format: selectedFormat, language: selectedLanguage, event: selectedEvent }),
    [selectedFormat, selectedLanguage, selectedEvent],
  );

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

  const selectedCinemaIds = useMemo(
    () => (selectedCinemaId ? new Set([selectedCinemaId]) : null),
    [selectedCinemaId],
  );
  const childMovieIds = useMemo(
    () =>
      activeChildrenOnly && catalogReady
        ? new Set(
            movies
              .filter((movie) =>
                isMovieForChildren(
                  movie,
                  showtimes.filter((showtime) => showtime.movieId === movie.id),
                ),
              )
              .map((movie) => movie.id),
          )
        : null,
    [activeChildrenOnly, catalogReady, movies, showtimes],
  );
  const facets = useMemo(
    () =>
      buildFilterFacets(showtimes, movies, {
        baseCinemaIds: nearbyCinemaIds ?? cityCinemaIds,
        cinemaIds: selectedCinemaIds,
        baseMovieIds: childMovieIds,
        date: selectedDate,
        time: selectedTime,
        genre: selectedGenre,
        format: selectedFormat,
        language: selectedLanguage,
        event: selectedEvent,
      }),
    [
      showtimes,
      movies,
      nearbyCinemaIds,
      cityCinemaIds,
      selectedCinemaIds,
      childMovieIds,
      selectedDate,
      selectedTime,
      selectedGenre,
      selectedFormat,
      selectedLanguage,
      selectedEvent,
    ],
  );

  const filtered = useMemo(() => {
    // The shell has no 30-day index. Keep its pre-ranked cards stable until the
    // complete programme arrives instead of treating empty filter data as zero results.
    if (!catalogReady) return movies;

    const allowed = selectedCinemaId
      ? new Set([selectedCinemaId])
      : (nearbyCinemaIds ?? cityCinemaIds);
    const matching = showtimes.filter(
      (s) =>
        allowed.has(s.cinemaId) &&
        (!selectedDate || s.date === selectedDate) &&
        (!selectedTime || showtimeMatchesTimePeriod(s.times, selectedTime)) &&
        showtimeMatchesTags(s, tagSel),
    );
    const movieIds = new Set(matching.map((s) => s.movieId));
    const visible = movies.filter(
      (m) =>
        movieIds.has(m.id) &&
        (!selectedGenre || m.genre.includes(selectedGenre)) &&
        (!childMovieIds || childMovieIds.has(m.id)),
    );
    return rankMoviesByScreenings(visible, matching);
  }, [
    catalogReady,
    movies,
    showtimes,
    selectedDate,
    selectedTime,
    selectedGenre,
    childMovieIds,
    tagSel,
    nearbyCinemaIds,
    cityCinemaIds,
    selectedCinemaId,
  ]);

  useEffect(() => {
    setVisibleMovieCount(INITIAL_MOVIE_CARD_COUNT);
  }, [filtered]);

  const visibleMovies = useMemo(
    () => filtered.slice(0, visibleMovieCount),
    [filtered, visibleMovieCount],
  );
  const hasMoreMovies = !catalogReady || visibleMovies.length < filtered.length;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMoreMovies || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        if (!catalogReady) {
          requestFullCatalog();
          return;
        }
        setVisibleMovieCount((count) => Math.min(count + MOVIE_CARD_BATCH_SIZE, filtered.length));
      },
      { rootMargin: "1200px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [catalogReady, filtered.length, hasMoreMovies, requestFullCatalog]);

  useTrackZeroResults(
    catalogReady ? filtered.length : 1,
    catalogReady &&
      Boolean(
        selectedDate ||
          selectedTime ||
          selectedGenre ||
          selectedFormat ||
          selectedLanguage ||
          selectedEvent ||
          activeChildrenOnly ||
          selectedCinemaId ||
          (radius !== "all" && userLoc),
      ),
    [
      canonicalSlug,
      catalogReady,
      selectedDate,
      selectedTime,
      selectedGenre,
      selectedFormat,
      selectedLanguage,
      selectedEvent,
      activeChildrenOnly,
      selectedCinemaId,
      radius,
    ],
  );

  const movieCountLabel = catalogReady
    ? String(movies.length)
    : `${activeCatalog.totalMovies}${activeCatalog.totalMoviesExact ? "" : "+"}`;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-6 py-10 sm:px-8 sm:py-16">
          <Link
            to="/"
            className="text-xs uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground"
          >
            ← Forside
          </Link>
          <div className="mt-4">
            <Breadcrumb items={[{ label: "Forside", to: "/" }, { label: cityName }]} />
          </div>
          <div className="mt-6 text-xs uppercase tracking-[0.25em] text-primary">By</div>
          <h1 className="mt-3 font-display text-5xl font-bold leading-[0.9] tracking-tight text-foreground sm:text-7xl">
            {activeChildrenOnly ? `Børnefilm i ${cityName}` : `Film i ${cityName}`}
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            {cinemas.length} {cinemas.length === 1 ? "biograf" : "biografer"} · {movieCountLabel} film
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-6 py-10 sm:px-8 sm:py-14">
        <GeoNotice className="mb-6" />
        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <div
            className="flex flex-wrap items-center gap-x-6 gap-y-3"
            onPointerEnter={requestFullCatalog}
            onPointerDown={requestFullCatalog}
            onFocusCapture={requestFullCatalog}
          >
            <h2 className="font-display text-2xl tracking-tight">Aktuelle film</h2>
            <FilterBar
              loading={!catalogReady}
              showChildrenFilter
              childrenOnly={fixedChildrenOnly}
              childrenRouteEnabled
              showTimeFilter
              availableDates={facets.dates}
              availableTimes={facets.times}
              genres={facets.genres}
              formats={facets.formats}
              languages={facets.languages}
              events={facets.events}
              cities={[
                { value: cityName, count: cinemas.length },
                ...otherCities.map((c) => ({ value: c.name, count: c.count })),
              ]}
              cinemas={cinemas
                .filter((c) => facets.cinemaIds.has(c.id))
                .map((c) => ({ id: c.id, slug: c.slug, name: c.name, city: c.city }))}
            />
          </div>
          <div className="text-right text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {geoLoading && <div>Finder din placering…</div>}
            <div>
              {catalogReady ? filtered.length : movieCountLabel} film
              {selectedDate ? ` · ${fmtDateLabel(selectedDate)}` : ""}
              {radius !== "all" && userLoc ? ` · inden for ${radius} km` : ""}
              {selectedGenre ? ` · ${selectedGenre}` : ""}
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
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visibleMovies.map((m, index) => (
                <MovieCard
                  key={m.id}
                  movie={m}
                  citySlug={canonicalSlug}
                  priority={index < LCP_PRIORITY_POSTERS}
                  sizes={MOVIE_CARD_SIZES}
                />
              ))}
            </div>
            {hasMoreMovies && (
              <div
                ref={loadMoreRef}
                data-testid="city-movie-load-sentinel"
                className="mt-12 flex min-h-px justify-center"
              >
                {catalogReady && visibleMovies.length < filtered.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleMovieCount((count) => count + MOVIE_CARD_BATCH_SIZE)}
                    className="rounded-full border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    Vis flere film ({filtered.length - visibleMovies.length})
                  </button>
                )}
              </div>
            )}
          </>
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
                <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {displayCityOf(c.city)}
                </div>
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
      <SiteFooter cinemas={cinemas} />
    </div>
  );
}
