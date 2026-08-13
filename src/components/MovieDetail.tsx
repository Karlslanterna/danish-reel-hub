import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Poster } from "@/components/Poster";
import { FilterBar, useFilters, haversineKm, fmtDateLabel } from "@/lib/filters";
import { collectTagOptions, showtimeMatchesTags, hasTagSelection } from "@/lib/showtime-tags";
import { formatRuntime, type Movie, type Cinema, type Showtime } from "@/lib/cinema-data";
import { displayCityOf, type CityOption } from "@/lib/city-slug";

export type MovieDetailCity = { name: string; slug: string };

export function MovieDetail({
  movie,
  cinemas: cinemasShowing,
  showtimes,
  city,
  cityOptions,
}: {
  movie: Movie;
  cinemas: Cinema[];
  showtimes: Showtime[];
  city?: MovieDetailCity;
  cityOptions?: CityOption[];
}) {
  const {
    radius,
    userLoc,
    selectedDate,
    selectedFormat,
    selectedLanguage,
    selectedEvent,
    selectedCity,
    setSelectedCity,
    selectedCinemaId,
    clear,
  } = useFilters();
  useCinemaUrlSync(cinemasShowing);

  // City is routing context: when this page is city-scoped, keep the global
  // (persisted) city filter in sync so the selection carries across the site.
  useEffect(() => {
    if (city?.name && city.name !== selectedCity) setSelectedCity(city.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city?.name]);

  const tagSel = { format: selectedFormat, language: selectedLanguage, event: selectedEvent };
  const tagOptions = collectTagOptions(showtimes);
  const hasGeo = radius !== "all" && userLoc !== null;

  const filteredCinemas = hasGeo
    ? cinemasShowing.filter((c) => {
        if (c.latitude == null || c.longitude == null) return false;
        return haversineKm(userLoc!, { lat: c.latitude, lng: c.longitude }) <= (radius as number);
      })
    : cinemasShowing;

  const filteredShowtimes = showtimes.filter(
    (s) => (!selectedDate || s.date === selectedDate) && showtimeMatchesTags(s, tagSel),
  );

  const byCinema = filteredCinemas
    .map((c) => ({ cinema: c, days: filteredShowtimes.filter((s) => s.cinemaId === c.id) }))
    .filter((x) => x.days.length > 0);

  const hasFilters = Boolean(selectedDate) || hasGeo || hasTagSelection(tagSel);

  const cityFilterOptions = (cityOptions ?? []).map((c) => ({ value: c.name, count: c.count }));


  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <section className="relative overflow-hidden border-b border-border/60">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-[30vh] md:h-[45vh]"
        >
          <div
            aria-hidden
            style={{
              "--p-a": movie.poster.a ?? "#8f332d",
              "--p-b": movie.poster.b ?? "#0b2545",
              "--p-c": movie.poster.c ?? "#111111",
              "--p-d": movie.poster.d ?? "#05070a",
            } as React.CSSProperties}
            className="poster-gradient absolute inset-0 scale-110 opacity-25 blur-3xl"
          />
          {movie.backdropUrl ? (
            <img
              src={movie.backdropUrl}
              alt=""
              aria-hidden
              loading="eager"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover object-center opacity-30"
            />
          ) : (
            movie.poster.url && (
              <img
                src={movie.poster.url}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover opacity-15 blur-2xl"
              />
            )
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-background/50 via-background/85 to-background" />
        </div>

        <div className="relative mx-auto max-w-[1400px] px-4 pb-6 pt-4 sm:px-6 md:px-8 md:pb-10 md:pt-6">
          <Breadcrumb
            items={
              city
                ? [
                    { label: "Forside", to: "/" },
                    { label: city.name, to: "/$city", params: { city: city.slug } },
                    { label: movie.title },
                  ]
                : [{ label: "Forside", to: "/" }, { label: "Film" }, { label: movie.title }]
            }
          />

          <div className="mt-4 grid grid-cols-[96px_1fr] gap-4 sm:grid-cols-[130px_1fr] sm:gap-6 lg:grid-cols-[200px_1fr] lg:gap-8">
            <div>
              <Poster
                movie={movie}
                showTitle={false}
                priority
                sizes="(min-width: 1024px) 200px, 130px"
                className="shadow-xl shadow-black/50"
              />
            </div>

            <div className="min-w-0">
              <h1 className="font-display text-2xl leading-tight tracking-tight text-foreground sm:text-3xl lg:text-5xl">
                {movie.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:text-sm">
                <span className="text-foreground">{formatRuntime(movie.runtime)}</span>
                <Dot />
                <span>{movie.genre.join(", ")}</span>
                <Dot />
                <span>{movie.year}</span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {movie.trailerUrl && (
                  <a
                    href={movie.trailerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-secondary"
                  >
                    <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                    </svg>
                    Se trailer
                  </a>
                )}
              </div>
            </div>
          </div>

          {movie.synopsis && (
            <p className="mt-5 max-w-3xl text-sm leading-relaxed text-foreground/80 sm:text-base">
              {movie.synopsis}
            </p>
          )}
        </div>
      </section>

      <section id="showtimes" className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 md:px-8 md:py-12">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <FilterBar
            formats={tagOptions.formats}
            languages={tagOptions.languages}
            events={tagOptions.events}
            cities={cityFilterOptions}
          />
        </div>

        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-xl tracking-tight sm:text-2xl">
            Spilletider{city ? ` i ${city.name}` : ""}
          </h2>
          <div className="flex items-center gap-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {byCinema.length} biografer{selectedDate ? ` · ${fmtDateLabel(selectedDate)}` : ""}
              {hasGeo ? ` · inden for ${radius} km` : ""}
            </div>
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
        </div>

        {byCinema.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-12 text-center">
            <p className="font-display text-lg text-foreground">
              {city ? `Ingen spilletider i ${city.name} lige nu` : "Ingen spilletider matcher dine filtre"}
            </p>
            {city ? (
              <Link
                to="/film/$slug"
                params={{ slug: movie.slug }}
                className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
              >
                Se spilletider i hele Danmark
              </Link>
            ) : (
              <button
                type="button"
                onClick={clear}
                className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
              >
                Ryd filtre
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-px overflow-hidden rounded-md bg-border">
            {byCinema.map(({ cinema, days }) => (
              <div key={cinema.id} className="bg-background p-4 sm:p-6 lg:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {displayCityOf(cinema.city)}
                    </div>
                    <Link
                      to="/biograf/$slug"
                      params={{ slug: cinema.slug }}
                      className="mt-1 inline-block font-display text-xl tracking-tight text-foreground hover:text-primary sm:text-2xl"
                    >
                      {cinema.name}
                    </Link>
                    <div className="mt-1 text-xs text-muted-foreground">{cinema.address}</div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  {days.map((d, i) => (
                    <div key={i}>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        {d.date} · {d.hall}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {d.times.map((t, idx) => {
                          const url = d.ticketUrls?.[idx] || d.bookingUrl;
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
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Dot() {
  return <span className="text-foreground/20">·</span>;
}
