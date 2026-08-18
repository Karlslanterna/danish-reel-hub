import { rankMoviesByScreenings } from "@/lib/movie-sort";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo } from "react";
import { MapPin, Clapperboard, Drama, Navigation, Globe } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Poster } from "@/components/Poster";
import { FilterBar, useFilters, fmtDateLabel } from "@/lib/filters";
import { collectTagOptions } from "@/lib/showtime-tags";
import { cinemaProgramShowtimesByMovie, groupCinemaShowtimesByDate } from "@/lib/cinema-program";
import {
  fetchCinemaBySlug,
  fetchMoviesAndShowtimesForCinemas,
  formatRuntime,
  type Cinema,
  type Movie,
  type Showtime,
} from "@/lib/cinema-data";
import { canonicalUrl } from "@/lib/canonical";
import { baseCityOf, citySlug } from "@/lib/city-slug";
import { cinemaSchemas } from "@/lib/jsonld";
import { SiteFooter } from "@/components/SiteFooter";
import { cinemaTitle, cinemaDescription } from "@/lib/seo";

export const Route = createFileRoute("/biograf/$slug")({
  loader: async ({ params }) => {
    const cinema = await fetchCinemaBySlug(params.slug);
    if (!cinema) throw notFound();
    const { movies, showtimes } = await fetchMoviesAndShowtimesForCinemas([cinema.id]);
    movies.sort((a, b) => a.title.localeCompare(b.title, "da"));
    return { cinema, movies, showtimes };
  },
  head: ({ params, loaderData }) => {
    const href = canonicalUrl(`/biograf/${params.slug}`);
    if (!loaderData)
      return {
        meta: [
          { title: "Biografen findes ikke | Lanterna" },
          { name: "robots", content: "noindex, follow" },
        ],
      };
    const { cinema, movies, showtimes } = loaderData;
    const cityLabel = baseCityOf(cinema.city);
    const hasScreenings = showtimes.length > 0;
    const title = cinemaTitle(cinema.name);
    const description = cinemaDescription(cinema.name, cityLabel, movies.length);
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
      links: [
        {
          rel: "canonical",
          href: hasScreenings ? href : canonicalUrl(`/${citySlug(cinema.city)}`),
        },
      ],
      scripts: cinemaSchemas(cinema),
    };
  },
  notFoundComponent: () => (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-8 py-24 text-center">
        <h1 className="font-display text-4xl">Biografen findes ikke</h1>
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
  component: CinemaPage,
});

function CinemaPage() {
  const { cinema, movies, showtimes } = Route.useLoaderData() as {
    cinema: Cinema;
    movies: Movie[];
    showtimes: Showtime[];
  };
  const { selectedDate, selectedGenre, selectedFormat, selectedLanguage, selectedEvent } =
    useFilters();
  const allGenres = useMemo(() => movies.flatMap((m) => m.genre), [movies]);
  const tagOptions = useMemo(() => collectTagOptions(showtimes), [showtimes]);
  const tagSel = useMemo(
    () => ({ format: selectedFormat, language: selectedLanguage, event: selectedEvent }),
    [selectedFormat, selectedLanguage, selectedEvent],
  );

  const filteredMovies = useMemo(
    () => (selectedGenre ? movies.filter((m) => m.genre.includes(selectedGenre)) : movies),
    [movies, selectedGenre],
  );

  const showtimesByMovie = useMemo(
    () => cinemaProgramShowtimesByMovie(showtimes, { date: selectedDate, ...tagSel }),
    [showtimes, selectedDate, tagSel],
  );

  const rows = rankMoviesByScreenings(filteredMovies, [...showtimesByMovie.values()].flat()).map(
    (m) => ({ movie: m, shows: showtimesByMovie.get(m.id) ?? [] }),
  );

  const withShows = rows.filter((r) => r.shows.length > 0);

  const cityLabel = cinema.city.replace(/^\s*\d{3,4}\s+/u, "").trim();
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${cinema.name}, ${cinema.address}, ${cinema.city}`,
  )}`;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-5 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-8">
          <Breadcrumb
            items={[
              { label: "Forside", to: "/" },
              {
                label: baseCityOf(cinema.city),
                to: "/$city",
                params: { city: citySlug(cinema.city) },
              },
              { label: cinema.name },
            ]}
          />

          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.25em] text-primary">
                {cityLabel}
              </div>
              <h1 className="mt-1.5 font-display text-3xl leading-[1.05] tracking-tight text-foreground sm:text-5xl">
                {cinema.name}
              </h1>
            </div>
          </div>

          {/* Compact profile card */}
          <div className="mt-5 rounded-xl border border-border/70 bg-card/40 p-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-foreground/85">
              {cinema.address && (
                <Fact icon={<MapPin className="h-3.5 w-3.5" />} text={cinema.address} />
              )}
              <Fact
                icon={<Clapperboard className="h-3.5 w-3.5" />}
                text={`${movies.length} film`}
              />
              {cinema.screens > 0 && (
                <Fact
                  icon={<Drama className="h-3.5 w-3.5" />}
                  text={`${cinema.screens} ${cinema.screens === 1 ? "sal" : "sale"}`}
                />
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <ActionLink
                href={mapsUrl}
                icon={<Navigation className="h-3.5 w-3.5" />}
                label="Rutevejledning"
                primary
              />
              {cinema.website && (
                <ActionLink
                  href={cinema.website}
                  icon={<Globe className="h-3.5 w-3.5" />}
                  label="Hjemmeside"
                />
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 sm:py-12">
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          <FilterBar
            hideRadius
            hideCity
            hideCinema
            genres={allGenres}
            formats={tagOptions.formats}
            languages={tagOptions.languages}
            events={tagOptions.events}
          />
          <div className="ml-auto text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {withShows.length} film
            {selectedDate ? ` · ${fmtDateLabel(selectedDate)}` : " på programmet"}
          </div>
        </div>

        {withShows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <p className="font-display text-xl text-foreground">
              {selectedDate
                ? `Ingen forestillinger ${fmtDateLabel(selectedDate).toLowerCase()}`
                : "Ingen film på programmet"}
            </p>
          </div>
        ) : (
          <div className="space-y-6 sm:space-y-8">
            {withShows.map(({ movie, shows }) => (
              <MovieRow key={movie.id} movie={movie} shows={shows} showDateLabels={!selectedDate} />
            ))}
          </div>
        )}
      </section>
      <SiteFooter cinemas={[cinema]} />
    </div>
  );
}

function Fact({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-primary">{icon}</span>
      <span className="truncate">{text}</span>
    </span>
  );
}

function ActionLink({
  href,
  icon,
  label,
  primary = false,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-colors ${
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border border-border bg-background text-foreground hover:border-primary/60 hover:text-primary"
      }`}
    >
      {icon}
      {label}
    </a>
  );
}

function MovieRow({
  movie,
  shows,
  showDateLabels,
  dim = false,
}: {
  movie: Movie;
  shows: Showtime[];
  showDateLabels: boolean;
  dim?: boolean;
}) {
  const facts = [formatRuntime(movie.runtime), movie.genre.join(", ")].filter(Boolean);
  const dateGroups = groupCinemaShowtimesByDate(shows);
  return (
    <div
      className={`rounded-xl border border-border/60 bg-card/30 p-4 sm:p-6 ${dim ? "opacity-60" : ""}`}
    >
      <div className="grid grid-cols-[96px_1fr] gap-4 sm:grid-cols-[150px_1fr] sm:gap-8">
        <Link to="/film/$slug" params={{ slug: movie.slug }} className="block">
          <Poster movie={movie} showTitle={false} />
        </Link>

        <div className="min-w-0">
          <Link
            to="/film/$slug"
            params={{ slug: movie.slug }}
            className="font-display text-xl leading-tight tracking-tight text-foreground hover:text-primary sm:text-2xl"
          >
            {movie.title}
          </Link>
          {facts.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {facts.map((fact, index) => (
                <span key={fact} className={index === facts.length - 1 ? "truncate" : undefined}>
                  {index > 0 && <span className="mr-2 text-foreground/20">·</span>}
                  {fact}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-3">
            {shows.length === 0 ? (
              <div className="text-xs text-muted-foreground">Ingen forestillinger denne dag</div>
            ) : (
              dateGroups.map(({ date, showtimes: dateShowtimes }) => (
                <div
                  key={date}
                  className={showDateLabels ? "grid gap-2 sm:grid-cols-[5rem_1fr]" : undefined}
                >
                  {showDateLabels && (
                    <div className="pt-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {fmtDateLabel(date)}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {dateShowtimes.flatMap((showtime, showtimeIndex) =>
                      showtime.times.map((time, timeIndex) => {
                        const url = showtime.ticketUrls?.[timeIndex] || showtime.bookingUrl;
                        const key = `${date}-${showtime.hall}-${showtimeIndex}-${time}-${timeIndex}`;
                        return url ? (
                          <a
                            key={key}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium tabular-nums text-primary-foreground transition-colors hover:bg-primary/90"
                          >
                            {time}
                          </a>
                        ) : (
                          <span
                            key={key}
                            className="rounded-md border border-border bg-card/40 px-3 py-1.5 text-sm font-medium tabular-nums text-muted-foreground"
                          >
                            {time}
                          </span>
                        );
                      }),
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
