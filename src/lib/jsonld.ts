import { canonicalUrl } from "./canonical";
import { baseCityOf, displayCityOf, citySlug as citySlugOf } from "./city-slug";
import type { Movie, Cinema, Showtime } from "./cinema-data";
import type { SpecialEventDefinition } from "./special-events";

const ld = (obj: unknown) => ({
  type: "application/ld+json" as const,
  children: JSON.stringify(obj),
});

export function homeSchemas() {
  const site = canonicalUrl("/");
  return [
    ld({
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${site}#website`,
      name: "Lanterna",
      alternateName: ["Lanterna.dk"],
      url: site,
    }),
    ld({
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${site}#organization`,
      name: "Lanterna",
      alternateName: "Lanterna.dk",
      url: site,
      logo: canonicalUrl("/icon-512.png"),
    }),
  ];
}

export function childrenMoviesSchemas(
  movies: Movie[],
  options?: { path?: string; name?: string; description?: string },
) {
  const url = canonicalUrl(options?.path ?? "/for-boern");
  return [
    ld({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: options?.name ?? "Børnefilm i biografen",
      description:
        options?.description ?? "Aktuelle børnefilm og spilletider i biografer i hele Danmark.",
      url,
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: movies.length,
        itemListElement: movies.slice(0, 100).map((movie, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "Movie",
            name: movie.title,
            url: canonicalUrl(`/film/${movie.slug}`),
            image: movie.poster.url || undefined,
            contentRating: movie.rating || undefined,
          },
        })),
      },
    }),
    breadcrumbSchema([
      { name: "Forside", url: canonicalUrl("/") },
      { name: "For børn", url },
    ]),
  ];
}

export function specialMoviesSchemas(event: SpecialEventDefinition, movies: Movie[]) {
  const url = canonicalUrl(event.path);
  return [
    ld({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: event.hero,
      description: event.description,
      url,
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: movies.length,
        itemListElement: movies.slice(0, 100).map((movie, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "Movie",
            name: movie.title,
            url: canonicalUrl(`/film/${movie.slug}`),
            image: movie.poster.url || undefined,
          },
        })),
      },
    }),
    breadcrumbSchema([
      { name: "Forside", url: canonicalUrl("/") },
      { name: event.tag, url },
    ]),
  ];
}

function breadcrumbSchema(items: { name: string; url: string }[]) {
  return ld({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  });
}

export function movieSchemas(
  movie: Movie,
  cinemas: Cinema[],
  showtimes: Showtime[],
  options?: { path?: string; breadcrumbs?: Array<{ name: string; url: string }> },
) {
  const cinemaById = new Map(cinemas.map((c) => [c.id, c] as const));
  const movieUrl = canonicalUrl(options?.path ?? `/film/${movie.slug}`);

  const movieObj: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Movie",
    name: movie.title,
    url: movieUrl,
    description: movie.synopsis || undefined,
  };
  if (movie.poster?.url) movieObj.image = movie.poster.url;
  if (movie.genre?.length) movieObj.genre = movie.genre;
  if (movie.runtime) movieObj.duration = `PT${movie.runtime}M`;
  if (movie.rating) movieObj.contentRating = movie.rating;
  if (movie.director) movieObj.director = { "@type": "Person", name: movie.director };
  if (movie.year) movieObj.datePublished = String(movie.year);

  const events: unknown[] = [];
  for (const s of showtimes) {
    const cinema = cinemaById.get(s.cinemaId);
    if (!cinema) continue;
    const location: Record<string, unknown> = {
      "@type": "MovieTheater",
      name: cinema.name,
      url: canonicalUrl(`/biograf/${cinema.slug}`),
    };
    if (cinema.address) {
      location.address = {
        "@type": "PostalAddress",
        streetAddress: cinema.address,
        addressLocality: displayCityOf(cinema.city),
        addressCountry: "DK",
      };
    }
    if (cinema.latitude != null && cinema.longitude != null) {
      location.geo = {
        "@type": "GeoCoordinates",
        latitude: cinema.latitude,
        longitude: cinema.longitude,
      };
    }
    s.times.forEach((t, i) => {
      const startDate =
        /^\d{4}-\d{2}-\d{2}$/.test(s.date) && /^\d{2}:\d{2}$/.test(t)
          ? `${s.date}T${t}:00`
          : undefined;
      const ticketUrl = s.ticketUrls?.[i] || s.bookingUrl || undefined;
      const ev: Record<string, unknown> = {
        "@type": "ScreeningEvent",
        name: movie.title,
        location,
      };
      if (startDate) ev.startDate = startDate;
      if (ticketUrl) ev.offers = { "@type": "Offer", url: ticketUrl };
      events.push(ev);
    });
  }

  const crumbs = breadcrumbSchema(
    options?.breadcrumbs ?? [
      { name: "Forside", url: canonicalUrl("/") },
      { name: movie.title, url: movieUrl },
    ],
  );

  // Search engines only need a representative set. Serializing thousands of
  // near-identical ScreeningEvent scripts made popular film pages megabytes
  // larger without improving the visitor experience or the core Movie entity.
  const representativeEvents = events.slice(0, 100);
  return [
    ld(movieObj),
    ...(representativeEvents.length > 0
      ? [ld({ "@context": "https://schema.org", "@graph": representativeEvents })]
      : []),
    crumbs,
  ];
}

export function cinemaSchemas(cinema: Cinema) {
  const obj: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MovieTheater",
    name: cinema.name,
    url: canonicalUrl(`/biograf/${cinema.slug}`),
  };
  if (cinema.address) {
    obj.address = {
      "@type": "PostalAddress",
      streetAddress: cinema.address,
      addressLocality: displayCityOf(cinema.city),
      addressCountry: "DK",
    };
  }
  if (cinema.latitude != null && cinema.longitude != null) {
    obj.geo = { "@type": "GeoCoordinates", latitude: cinema.latitude, longitude: cinema.longitude };
  }
  const cityName = baseCityOf(cinema.city);
  const citySlug = citySlugOf(cinema.city);
  const crumbs = breadcrumbSchema([
    { name: "Forside", url: canonicalUrl("/") },
    { name: cityName, url: canonicalUrl(`/${citySlug}`) },
    { name: cinema.name, url: canonicalUrl(`/biograf/${cinema.slug}`) },
  ]);
  return [ld(obj), crumbs];
}

export function citySchemas(citySlug: string, cityName: string) {
  const url = canonicalUrl(`/${citySlug}`);
  return [
    ld({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `Film i ${cityName}`,
      url,
    }),
    ld({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Forside", item: canonicalUrl("/") },
        { "@type": "ListItem", position: 2, name: cityName, item: url },
      ],
    }),
  ];
}
