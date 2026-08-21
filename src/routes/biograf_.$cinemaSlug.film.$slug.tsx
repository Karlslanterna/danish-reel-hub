import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo } from "react";
import { MapPin } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Poster } from "@/components/Poster";
import { FilterBar, fmtDateLabel, useFilters } from "@/lib/filters";
import {
  fetchCinemaBySlug,
  fetchMovieBySlug,
  fetchMoviesAndShowtimesForCinemas,
  formatRuntime,
  type Cinema,
  type Movie,
  type Showtime,
} from "@/lib/cinema-data";
import { cinemaProgramShowtimesByMovie, groupCinemaShowtimesByDate } from "@/lib/cinema-program";
import { buildFilterFacets } from "@/lib/filter-facets";
import { isMovieForChildren } from "@/lib/children-filter";
import { canonicalUrl } from "@/lib/canonical";
import { baseCityOf, citySlug } from "@/lib/city-slug";
import { movieSchemas } from "@/lib/jsonld";
import { cinemaMovieDescription, cinemaMovieTitle } from "@/lib/seo";
import { trackAnalyticsEvent, useTrackZeroResults } from "@/lib/analytics";

// TanStack's Vite plugin adds this new non-nested file route to routeTree.gen.ts
// during build. CI intentionally typechecks before that code-generation step.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute("/biograf_/$cinemaSlug/film/$slug" as any)({
  loader: async ({ params }) => {
    const [cinema, movie] = await Promise.all([
      fetchCinemaBySlug(params.cinemaSlug),
      fetchMovieBySlug(params.slug),
    ]);
    if (!cinema || !movie) throw notFound();

    const { movies, showtimes } = await fetchMoviesAndShowtimesForCinemas([cinema.id]);
    const representedIds = new Set(movie.sourceIds ?? [movie.id]);
    const localMovie = movies.find((candidate) =>
      (candidate.sourceIds ?? [candidate.id]).some((id) => representedIds.has(id)),
    );
    const relevantShowtimes = localMovie
      ? showtimes
          .filter((showtime) => showtime.movieId === localMovie.id)
          .map((showtime) => ({ ...showtime, movieId: movie.id }))
      : [];

    return { cinema, movie, showtimes: relevantShowtimes };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Filmen eller biografen findes ikke | Lanterna" },
          { name: "robots", content: "noindex, follow" },
        ],
      };
    }

    const { cinema, movie, showtimes } = loaderData;
    const href = canonicalUrl(`/biograf/${cinema.slug}/film/${movie.slug}`);
    const hasScreenings = showtimes.some((showtime) => showtime.times.length > 0);
    const screeningCount = showtimes.reduce((sum, showtime) => sum + showtime.times.length, 0);
    const city = baseCityOf(cinema.city);
    const title = cinemaMovieTitle(movie.title, cinema.name);
    const description = cinemaMovieDescription(movie.title, cinema.name, city, screeningCount);
    const image = movie.poster.url;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...(hasScreenings ? [] : [{ name: "robots", content: "noindex, follow" }]),
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: href },
        { property: "og:type", content: "video.movie" },
        ...(image
          ? [
              { property: "og:image", content: image },
              { name: "twitter:image", content: image },
            ]
          : []),
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [
        {
          rel: "canonical",
          href: hasScreenings ? href : canonicalUrl(`/film/${movie.slug}`),
        },
      ],
      scripts: movieSchemas(movie, [cinema], showtimes, {
        path: `/biograf/${cinema.slug}/film/${movie.slug}`,
        breadcrumbs: [
          { name: "Forside", url: canonicalUrl("/") },
          { name: city, url: canonicalUrl(`/${citySlug(cinema.city)}`) },
          { name: cinema.name, url: canonicalUrl(`/biograf/${cinema.slug}`) },
          { name: movie.title, url: href },
        ],
      }),
    };
  },
  notFoundComponent: () => (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-8 py-24 text-center">
        <h1 className="font-display text-4xl">Siden findes ikke</h1>
        <Link to="/" className="mt-6 inline-block text-sm text-primary hover:underline">
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
  component: CinemaMoviePage,
});

function CinemaMoviePage() {
  const { cinema, movie, showtimes } = Route.useLoaderData() as {
    cinema: Cinema;
    movie: Movie;
    showtimes: Showtime[];
  };
  const {
    selectedDate,
    selectedTime,
    selectedGenre,
    selectedFormat,
    selectedLanguage,
    selectedEvent,
    childrenOnly,
  } = useFilters();

  const childEligible = useMemo(
    () => isMovieForChildren(movie, showtimes),
    [movie, showtimes],
  );
  const fixedMovieMatches =
    (!selectedGenre || movie.genre.includes(selectedGenre)) && (!childrenOnly || childEligible);
  const baseMovieIds = useMemo(
    () => (fixedMovieMatches ? new Set([movie.id]) : new Set<string>()),
    [fixedMovieMatches, movie.id],
  );

  const facets = useMemo(
    () =>
      buildFilterFacets(showtimes, [movie], {
        baseCinemaIds: new Set([cinema.id]),
        baseMovieIds,
        date: selectedDate,
        time: selectedTime,
        genre: selectedGenre,
        format: selectedFormat,
        language: selectedLanguage,
        event: selectedEvent,
      }),
    [
      showtimes,
      movie,
      cinema.id,
      baseMovieIds,
      selectedDate,
      selectedTime,
      selectedGenre,
      selectedFormat,
      selectedLanguage,
      selectedEvent,
    ],
  );

  const filteredShowtimes = useMemo(() => {
    if (!fixedMovieMatches) return [];
    return (
      cinemaProgramShowtimesByMovie(showtimes, {
        date: selectedDate,
        time: selectedTime,
        format: selectedFormat,
        language: selectedLanguage,
        event: selectedEvent,
      }).get(movie.id) ?? []
    );
  }, [
    fixedMovieMatches,
    showtimes,
    movie.id,
    selectedDate,
    selectedTime,
    selectedFormat,
    selectedLanguage,
    selectedEvent,
  ]);

  const dateGroups = useMemo(
    () => groupCinemaShowtimesByDate(filteredShowtimes),
    [filteredShowtimes],
  );
  const screeningCount = showtimes.reduce((sum, showtime) => sum + showtime.times.length, 0);
  const filteredCount = filteredShowtimes.reduce(
    (sum, showtime) => sum + showtime.times.length,
    0,
  );
  const city = baseCityOf(cinema.city);
  const facts = [
    formatRuntime(movie.runtime),
    movie.genre.join(", "),
    movie.year > 0 ? String(movie.year) : "",
  ].filter(Boolean);

  useTrackZeroResults(
    filteredCount,
    Boolean(
      selectedDate ||
        selectedTime ||
        selectedGenre ||
        selectedFormat ||
        selectedLanguage ||
        selectedEvent ||
        childrenOnly
    ),
    [
      cinema.slug,
      movie.slug,
      selectedDate,
      selectedTime,
      selectedGenre,
      selectedFormat,
      selectedLanguage,
      selectedEvent,
      childrenOnly,
    ],
  );

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-5 pb-8 pt-5 sm:px-8 sm:pt-8">
          <Breadcrumb
            items={[
              { label: "Forside", to: "/" },
              { label: city, to: "/$city", params: { city: citySlug(cinema.city) } },
              { label: cinema.name, to: "/biograf/$slug", params: { slug: cinema.slug } },
              { label: movie.title },
            ]}
          />

          <div className="mt-5 grid grid-cols-[96px_minmax(0,1fr)] gap-4 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-7 lg:grid-cols-[200px_minmax(0,1fr)]">
            <Poster
              movie={movie}
              showTitle={false}
              priority
              sizes="(min-width: 1024px) 200px, (min-width: 640px) 150px, 96px"
              className="shadow-xl shadow-black/40"
            />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-primary">{cinema.name}</div>
              <h1 className="mt-1 font-display text-2xl leading-tight tracking-tight text-foreground sm:text-4xl lg:text-5xl">
                {movie.title} i {cinema.name}
              </h1>
              {facts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground sm:text-sm">
                  {facts.map((fact, index) => (
                    <span key={fact}>
                      {index > 0 && <span className="mr-2 text-foreground/20">·</span>}
                      {fact}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-4 max-w-3xl text-sm leading-relaxed text-foreground/90 sm:text-base">
                {screeningCount > 0
                  ? `${movie.title} har ${screeningCount} ${screeningCount === 1 ? "kommende forestilling" : "kommende forestillinger"} i ${cinema.name} i ${city}. Vælg en spilletid herunder og køb billet direkte hos biografen.`
                  : `${movie.title} har ingen kommende forestillinger i ${cinema.name} lige nu.`}
              </p>
              {movie.synopsis && (
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-foreground/75">
                  {movie.synopsis}
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card/35 p-4 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span>{cinema.address || city}</span>
            <Link
              to="/biograf/$slug"
              params={{ slug: cinema.slug }}
              className="ml-auto text-primary underline-offset-4 hover:underline"
            >
              Hele programmet i {cinema.name}
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 sm:py-12">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <FilterBar
            hideRadius
            hideCity
            hideCinema
            showChildrenFilter={childrenOnly}
            showTimeFilter
            availableDates={facets.dates}
            availableTimes={facets.times}
            genres={facets.genres}
            formats={facets.formats}
            languages={facets.languages}
            events={facets.events}
          />
          <div className="ml-auto text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {filteredCount} {filteredCount === 1 ? "forestilling" : "forestillinger"}
          </div>
        </div>

        <h2 className="font-display text-xl tracking-tight sm:text-2xl">Spilletider i {cinema.name}</h2>

        {dateGroups.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-border py-14 text-center">
            <p className="font-display text-lg text-foreground">Ingen spilletider matcher dine filtre</p>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {dateGroups.map(({ date, slots }) => (
              <div key={date} className="rounded-xl border border-border/60 bg-card/30 p-4 sm:p-5">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {fmtDateLabel(date)}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {slots.map(({ time, url, hall }, index) => {
                    const key = `${date}-${hall}-${time}-${index}`;
                    return url ? (
                      <a
                        key={key}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer nofollow sponsored"
                        onClick={() =>
                          trackAnalyticsEvent({
                            eventType: "ticket_click",
                            itemType: "movie",
                            itemId: movie.slug,
                          })
                        }
                        className="rounded-md bg-primary px-3 py-2 text-sm font-medium tabular-nums text-primary-foreground transition-colors hover:bg-primary/90"
                      >
                        {time}
                        {hall ? <span className="ml-1.5 text-[10px] opacity-70">{hall}</span> : null}
                      </a>
                    ) : (
                      <span
                        key={key}
                        className="rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums text-muted-foreground"
                      >
                        {time}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-2">
          <Link
            to="/$city/film/$slug"
            params={{ city: citySlug(cinema.city), slug: movie.slug }}
            className="rounded-full border border-border px-4 py-2 text-sm text-foreground hover:border-primary hover:text-primary"
          >
            {movie.title} i {city}
          </Link>
          <Link
            to="/film/$slug"
            params={{ slug: movie.slug }}
            className="rounded-full border border-border px-4 py-2 text-sm text-foreground hover:border-primary hover:text-primary"
          >
            {movie.title} i hele Danmark
          </Link>
        </div>
      </section>

      <SiteFooter cinemas={[cinema]} />
    </div>
  );
}
