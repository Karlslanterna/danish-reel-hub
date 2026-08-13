import { Link } from "@tanstack/react-router";
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
  const { radius, userLoc, selectedDate, selectedFormat, selectedLanguage, selectedEvent, clear } = useFilters();
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
        {movie.backdropUrl ? (
          <img
            src={movie.backdropUrl}
            alt=""
            aria-hidden
            loading="eager"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover object-center opacity-40"
          />
        ) : (
          movie.poster.url && (
            <img
              src={movie.poster.url}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover opacity-20 blur-2xl"
            />
          )
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" />

        <div className="relative mx-auto grid max-w-[1400px] grid-cols-1 gap-12 px-8 py-16 lg:grid-cols-[340px_1fr]">
          <div>
            <Poster movie={movie} showTitle={false} priority sizes="(min-width: 1024px) 340px, 100vw" className="shadow-2xl shadow-black/60" />
          </div>

          <div className="flex flex-col">
            {city ? (
              <Link
                to="/$city"
                params={{ city: city.slug }}
                className="text-xs uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground"
              >
                ← {city.name}
              </Link>
            ) : (
              <Link to="/" className="text-xs uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground">
                ← Tilbage
              </Link>
            )}
            <div className="mt-4">
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
            </div>
            <div className="mt-6 text-xs uppercase tracking-[0.25em] text-primary">
              {movie.genre.join(" · ")}
            </div>
            <h1 className="mt-3 font-display text-6xl leading-[0.95] tracking-tight text-foreground">
              {movie.title}
            </h1>
            {city && (
              <div className="mt-3 inline-flex w-fit items-center gap-2 rounded-full border border-primary/60 bg-primary/10 px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18M5 21V7l8-4 8 4v14M8 21v-9a2 2 0 0 1 4 0v9" />
                </svg>
                Spilletider i {city.name}
              </div>
            )}
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
              {movie.trailerUrl && (
                <a
                  href={movie.trailerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-card/60 px-5 py-3 text-sm font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-secondary"
                >
                  <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                  </svg>
                  Se trailer
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {cityOptions && cityOptions.length > 0 && (
        <section className="border-b border-border/60">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-8 py-5">
            <span className="mr-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Skift by
            </span>
            <Link
              to="/film/$slug"
              params={{ slug: movie.slug }}
              className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.15em] transition-colors ${
                city ? "border-border bg-card/40 text-muted-foreground hover:border-primary/60 hover:text-foreground" : "border-primary bg-primary text-primary-foreground"
              }`}
            >
              Hele Danmark
            </Link>
            {cityOptions.map((c) => (
              <Link
                key={c.slug}
                to="/$city/film/$slug"
                params={{ city: c.slug, slug: movie.slug }}
                className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.15em] transition-colors ${
                  city?.slug === c.slug
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card/40 text-muted-foreground hover:border-primary/60 hover:text-foreground"
                }`}
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section id="showtimes" className="mx-auto max-w-[1400px] px-8 py-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <h2 className="font-display text-2xl tracking-tight">
              Spilletider{city ? ` i ${city.name}` : ""}
            </h2>
            <FilterBar formats={tagOptions.formats} languages={tagOptions.languages} events={tagOptions.events} />
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
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {byCinema.length} biografer{selectedDate ? ` · ${fmtDateLabel(selectedDate)}` : ""}{hasGeo ? ` · inden for ${radius} km` : ""}
          </div>
        </div>

        {byCinema.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-16 text-center">
            <p className="font-display text-xl text-foreground">
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
              <div key={cinema.id} className="bg-background p-6 lg:p-8">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{displayCityOf(cinema.city)}</div>
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
